import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { matchConfirmedPayee, payeeIdentities } from './matching';
import { payeeCandidateMatchSql, payeeSourceValiditySql } from './sql';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), categories: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos/category.repo', () => ({ categoryRepo: { listAll: mocks.categories } }));
import { getCategorizationRecords } from '../review';
import { getPayeeLearningContext, saveConfirmedPayee, listPayeeMemories, loadActivePayeeMemories, loadPrivatePayeeNames, disablePayeeMemory, PayeeMemoryConflictError, InvalidPayeeMemoryError } from './service';
import { payeeMemoryRepo } from './repository';
import { payeeMemorySchema } from './schema';

const url = process.env.DATA_PLAN_TEST_PG_URL;
const categories = [{ id: 1, name: 'Cleaning' }, { id: 2, name: 'Pet care' }, { id: 3, name: 'Transfers' }];

describe.skipIf(!url)('private payee knowledge in disposable PostgreSQL', () => {
  const namespace = `payee_test_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;
  beforeAll(async () => {
    fixture = new Client({ connectionString: url }); await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${namespace}"`); await fixture.query(`SET search_path TO "${namespace}",public`);
    await fixture.query(`
      CREATE TABLE categories(id integer PRIMARY KEY,name text NOT NULL,parent_id integer);
      CREATE TABLE accounts(id integer PRIMARY KEY,name text NOT NULL,account_type text NOT NULL,owner_id integer);
      CREATE TABLE journal_entries(id integer PRIMARY KEY,date text NOT NULL,description text NOT NULL,reference text,property_id integer,category_id integer REFERENCES categories(id),is_transfer boolean NOT NULL DEFAULT false,transfer_group_id uuid,transfer_partner_journal_id integer,sync_run_id integer);
      CREATE TABLE book_entries(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,journal_entry_id integer REFERENCES journal_entries(id),account_id integer REFERENCES accounts(id),amount numeric(14,2) NOT NULL);
      CREATE TABLE transaction_metadata(journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id),merchant_name text,bank_category text,transaction_type text,currency text);
      CREATE TABLE transaction_categorizations(journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id),snapshot_hash text NOT NULL,context_key text NOT NULL,category_id integer REFERENCES categories(id),confidence numeric,reason text NOT NULL,evidence jsonb,source text NOT NULL CHECK(source IN ('user','ai','rule','learned')),status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE categorization_learning(context_key text PRIMARY KEY,category_id integer NOT NULL REFERENCES categories(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    `);
    const migration = await readFile(new URL('../../db/migration.sql', import.meta.url), 'utf8').catch(async () => readFile(new URL('../../../db/migration.sql', import.meta.url), 'utf8'));
    const marker = migration.indexOf('-- Private confirmed payee meanings.');
    if (marker < 0) throw new Error('Missing private payee migration.');
    await fixture.query(migration.slice(marker)); await fixture.query(migration.slice(marker));
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${namespace},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((query: SQL) => { const rendered = dialect.sqlToQuery(query); return pool.query(rendered.sql, rendered.params); });
    mocks.categories.mockResolvedValue(categories);
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await fixture.end(); } });
  beforeEach(async () => {
    await fixture.query('TRUNCATE categorization_payee_aliases,categorization_payee_memories,transaction_categorizations,categorization_learning,transaction_metadata,book_entries,journal_entries,accounts,categories RESTART IDENTITY CASCADE');
    await fixture.query("INSERT INTO categories(id,name) VALUES(1,'Cleaning'),(2,'Pet care'),(3,'Transfers'); INSERT INTO accounts VALUES(11,'Home bank','ASSET',1),(12,'Expense','EXPENSE',NULL),(21,'Other bank','ASSET',2)");
    for (const [id, description] of [[1, 'PAYMENT TO Avery REF October cleaning'], [2, 'PAYMENT TO AVERY REF November cleaning'], [3, 'PAYMENT TO Avery Jones REF November']] as const) {
      await fixture.query('INSERT INTO journal_entries(id,date,description) VALUES($1,$2,$3)', [id, '2026-10-01', description]);
      await fixture.query("INSERT INTO transaction_metadata(journal_entry_id,transaction_type,currency) VALUES($1,'bank_transfer','GBP')", [id]);
      await fixture.query('INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES($1,11,-40),($1,12,40)', [id]);
    }
  });
  const save = async (extra: Record<string, unknown> = {}) => {
    const [record] = await getCategorizationRecords([1]);
    return saveConfirmedPayee({ journalId: 1, snapshot: record.snapshot, categoryId: 1, payeeName: 'Avery', purpose: 'Household cleaner', identityKind: 'bank_payee', ...extra });
  };
  it('atomically confirms a payment and remembers a recipient across changing references without changing ledger amounts', async () => {
    const before = (await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows;
    const result = await save();
    expect(result).toMatchObject({ applied: true, memory: { revision: 1, status: 'active', aliases: ['Avery'], purpose: 'Household cleaner' } });
    expect(payeeMemorySchema.safeParse(result.memory).success).toBe(true);
    expect((await fixture.query('SELECT category_id FROM journal_entries WHERE id=1')).rows[0].category_id).toBe(1);
    expect((await fixture.query('SELECT source,status,payee_memory_id FROM transaction_categorizations WHERE journal_entry_id=1')).rows[0]).toMatchObject({ source: 'user', status: 'reviewed', payee_memory_id: null });
    const [next, other] = await getCategorizationRecords([2, 3]);
    const candidates = [next, other].map(record => ({ ...record, id: record.journalId }));
    const memories = await loadActivePayeeMemories(candidates);
    expect(matchConfirmedPayee(candidates[0], memories, categories)?.memory.id).toBe(result.memory.id);
    expect(matchConfirmedPayee(candidates[1], memories, categories)).toBeNull();
    expect((await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows).toEqual(before);
  });
  it('has matching SQL and JavaScript identity behaviour for bank recipient references and name collisions', async () => {
    const result = await save();
    const rows = await mocks.execute(sql`SELECT je.id FROM journal_entries je JOIN categorization_payee_memories pm ON pm.id=${result.memory.id}::uuid WHERE ${payeeSourceValiditySql()} AND ${payeeCandidateMatchSql()} ORDER BY je.id`);
    expect(rows.rows.map((row: { id: number }) => row.id)).toEqual([1, 2]);
    const records = await getCategorizationRecords([1, 2, 3]);
    expect(records.filter(record => matchConfirmedPayee({ ...record, id: record.journalId }, [result.memory], categories)).map(record => record.journalId)).toEqual([1, 2]);
    expect(payeeIdentities({ ...records[1], id: 2 }).find(identity => identity.kind === 'bank_payee')?.value).toBe('AVERY');
    await fixture.query("UPDATE journal_entries SET description='PAYMENT TO Avery Ref Services REF November' WHERE id=2");
    const ambiguous = await mocks.execute(sql`SELECT je.id FROM journal_entries je JOIN categorization_payee_memories pm ON pm.id=${result.memory.id}::uuid WHERE ${payeeSourceValiditySql()} AND ${payeeCandidateMatchSql()} ORDER BY je.id`);
    expect(ambiguous.rows.map((row: { id: number }) => row.id)).toEqual([1]);
  });
  it('rejects conflicting simultaneous saves instead of creating duplicate meanings or losing the category confirmation', async () => {
    const [record] = await getCategorizationRecords([1]);
    const input = { journalId: 1, snapshot: record.snapshot, categoryId: 1, payeeName: 'Avery', identityKind: 'bank_payee' as const };
    const saved = await Promise.allSettled([saveConfirmedPayee(input), saveConfirmedPayee(input)]);
    expect(saved.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    expect((await fixture.query('SELECT count(*) FROM categorization_payee_memories')).rows[0].count).toBe('1');
    expect((await fixture.query('SELECT category_id FROM journal_entries WHERE id=1')).rows[0].category_id).toBe(1);
  });
  it('updates an existing meaning with revision protection without double-modifying retained aliases', async () => {
    const first = await save();
    const updated = await save({ memoryId: first.memory.id, expectedRevision: 1, categoryId: 2, purpose: 'Pet sitter', aliases: ['Avery P'] });
    expect(updated.memory).toMatchObject({ revision: 2, categoryId: 2, aliases: ['Avery', 'Avery P'] });
    await expect(save({ memoryId: first.memory.id, expectedRevision: 1 })).rejects.toBeInstanceOf(PayeeMemoryConflictError);
    expect((await fixture.query('SELECT category_id FROM journal_entries WHERE id=1')).rows[0].category_id).toBe(2);
  });
  it('retires a meaning after its source confirmation is changed and keeps personal names out of public research', async () => {
    const first = await save();
    await fixture.query('UPDATE journal_entries SET category_id=2 WHERE id=1');
    const [record] = await getCategorizationRecords([2]);
    expect(await loadActivePayeeMemories([{ ...record, id: 2 }])).toEqual([]);
    expect(await payeeMemoryRepo.get(first.memory.id)).toMatchObject({ status: 'conflicted', revision: 1 });
    expect((await listPayeeMemories())[0]).toMatchObject({ status: 'conflicted', revision: 1 });
    expect(await getPayeeLearningContext(2)).toMatchObject({ eligible: true, existingMemory: null });
    expect((await fixture.query('SELECT status,revision FROM categorization_payee_memories WHERE id=$1', [first.memory.id])).rows[0]).toMatchObject({ status: 'active', revision: 1 });
    expect(await loadPrivatePayeeNames()).toContain('Avery');
  });
  it('retires only a conflicting legacy exact mapping when the user explicitly confirms a new private meaning', async () => {
    const [record] = await getCategorizationRecords([1]);
    const { categorizationContextKey } = await import('../decisions');
    const key = categorizationContextKey({ ...record, id: 1 });
    await fixture.query('INSERT INTO categorization_learning(context_key,category_id) VALUES($1,2)', [key]);
    await save();
    expect((await fixture.query('SELECT count(*) FROM categorization_learning WHERE context_key=$1', [key])).rows[0].count).toBe('0');
  });
  it('keeps disabled knowledge private and uses revision checks for manual controls', async () => {
    const first = await save();
    expect(await disablePayeeMemory(first.memory.id, 1)).toMatchObject({ status: 'disabled', revision: 2 });
    await expect(disablePayeeMemory(first.memory.id, 1)).rejects.toBeInstanceOf(PayeeMemoryConflictError);
    expect(await loadPrivatePayeeNames()).toContain('Avery');
    const [record] = await getCategorizationRecords([2]);
    expect(await loadActivePayeeMemories([{ ...record, id: 2 }])).toEqual([]);
  });
  it('shows only the current alias set after repeated edits and disable, while retaining historical privacy exclusions', async () => {
    const first = await save({ aliases: Array.from({ length: 8 }, (_, index) => `Old recipient ${index}`) });
    const replacement = Array.from({ length: 8 }, (_, index) => `New recipient ${index}`);
    const updated = await save({ memoryId: first.memory.id, expectedRevision: first.memory.revision, aliases: replacement });
    expect(updated.memory.aliases).toHaveLength(9);
    const disabled = await disablePayeeMemory(first.memory.id, updated.memory.revision);
    expect(disabled.aliases).toHaveLength(9);
    expect(disabled.aliases).toContain('Avery');
    expect(disabled.aliases).not.toContain('Old recipient 0');
    expect(payeeMemorySchema.safeParse(disabled).success).toBe(true);
    expect(await loadPrivatePayeeNames()).toContain('Old recipient 0');
  });
  it('never learns generic payment rails, transfer categories or linked account movements', async () => {
    await expect(save({ aliases: ['PayPal'] })).rejects.toBeInstanceOf(InvalidPayeeMemoryError);
    await expect(save({ categoryId: 3 })).rejects.toBeInstanceOf(InvalidPayeeMemoryError);
    await fixture.query('UPDATE journal_entries SET is_transfer=TRUE WHERE id=1');
    expect(await getPayeeLearningContext(1)).toMatchObject({ eligible: false });
    await expect(save()).rejects.toBeInstanceOf(PayeeMemoryConflictError);
    expect((await fixture.query('SELECT count(*) FROM categorization_payee_memories')).rows[0].count).toBe('0');
  });
});
