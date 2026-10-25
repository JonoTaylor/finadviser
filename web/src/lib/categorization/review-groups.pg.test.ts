import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { categorizationContextKey } from './decisions';
import { getCategorizationRecords, CategorizationConflictError, InvalidCategorizationError } from './review';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { decideReviewGroup, loadReviewGroups } from './review-groups';
import type { ReviewGroup } from './review-groups';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('grouped payment review in disposable PostgreSQL', () => {
  const namespace = `review_groups_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;
  let beforeWrite: (() => Promise<void>) | null = null;
  beforeAll(async () => {
    fixture = new Client({ connectionString: url }); await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${namespace}"`); await fixture.query(`SET search_path TO "${namespace}",public`);
    await fixture.query(`
      CREATE TYPE account_type AS ENUM ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE');
      CREATE TABLE categories(id integer PRIMARY KEY,name text NOT NULL,parent_id integer);
      CREATE TABLE accounts(id integer PRIMARY KEY,name text NOT NULL,account_type account_type NOT NULL,owner_id integer);
      CREATE TABLE journal_entries(id integer PRIMARY KEY,date text NOT NULL,description text NOT NULL,reference text,property_id integer,category_id integer REFERENCES categories(id),is_transfer boolean NOT NULL DEFAULT false,transfer_group_id uuid,transfer_partner_journal_id integer,sync_run_id integer);
      CREATE TABLE book_entries(id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,journal_entry_id integer REFERENCES journal_entries(id),account_id integer REFERENCES accounts(id),amount numeric(14,2) NOT NULL);
      CREATE TABLE transaction_metadata(journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id),merchant_name text,bank_category text,transaction_type text,currency text);
      CREATE TABLE transaction_categorizations(journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id),snapshot_hash text NOT NULL,context_key text NOT NULL,category_id integer REFERENCES categories(id),confidence numeric,reason text NOT NULL,evidence jsonb,source text NOT NULL,status text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
      CREATE TABLE categorization_learning(context_key text PRIMARY KEY,category_id integer NOT NULL REFERENCES categories(id),created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now());
    `);
    const migration = await readFile(new URL('../db/migration.sql', import.meta.url), 'utf8');
    const marker = migration.indexOf('-- Private confirmed payee meanings.');
    if (marker < 0) throw new Error('Missing private payee migration.');
    await fixture.query(migration.slice(marker));
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${namespace},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(async (query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      if (/WITH proposed AS/.test(rendered.sql) && beforeWrite) { const run = beforeWrite; beforeWrite = null; await run(); }
      return pool.query(rendered.sql, rendered.params);
    });
  });
  afterAll(async () => { await pool?.end(); if (fixture) { await fixture.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await fixture.end(); } });
  beforeEach(async () => {
    beforeWrite = null;
    await fixture.query('TRUNCATE categorization_payee_aliases,categorization_payee_memories,transaction_categorizations,categorization_learning,transaction_metadata,book_entries,journal_entries,accounts,categories RESTART IDENTITY CASCADE');
    await fixture.query("INSERT INTO categories(id,name) VALUES(1,'Subscriptions'),(2,'Household'),(3,'Other'); INSERT INTO accounts VALUES(11,'Home bank','ASSET',1),(12,'Expense','EXPENSE',NULL),(21,'Other bank','ASSET',2)");
  });
  async function seed(id: number, options: { accountId?: number; description?: string; propertyId?: number; currency?: string; categoryId?: number } = {}) {
    await fixture.query('INSERT INTO journal_entries(id,date,description,property_id) VALUES($1,$2,$3,$4)', [id, '2024-05-16', options.description ?? 'SYNTHETIC SERVICE', options.propertyId ?? null]);
    await fixture.query("INSERT INTO transaction_metadata(journal_entry_id,merchant_name,transaction_type,currency) VALUES($1,'Synthetic service','card_payment',$2)", [id, options.currency ?? 'GBP']);
    await fixture.query('INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES($1,$2,-8.99),($1,12,8.99)', [id, options.accountId ?? 11]);
    const [record] = await getCategorizationRecords([id]);
    const key = categorizationContextKey({ ...record, id });
    await fixture.query("INSERT INTO transaction_categorizations(journal_entry_id,snapshot_hash,context_key,category_id,confidence,reason,source,status) VALUES($1,$2,$3,$4,.85,'Service suggestion','ai','needs_review')", [id, record.snapshot, key, options.categoryId ?? 1]);
  }
  const selection = (group: ReviewGroup) => ({ groupKey: group.key, items: group.items.map(({ journalId, snapshot, reviewVersion }) => ({ journalId, snapshot, reviewVersion })) });
  const rows = async () => (await fixture.query('SELECT je.id,je.category_id,tc.status,tc.source FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id=je.id ORDER BY je.id')).rows;

  it('groups repeated exact contexts across dates while separating account, property, description and currency', async () => {
    await seed(1); await seed(2); await seed(3, { accountId: 21 }); await seed(4, { propertyId: 99 });
    await seed(5, { description: 'SYNTHETIC SERVICE OTHER PURCHASE' }); await seed(6, { currency: 'EUR' });
    const queue = await loadReviewGroups();
    expect(queue).toMatchObject({ totalPayments: 6, totalGroups: 5, hasMore: false, nextCursor: null });
    expect(queue.groups.find(group => group.items.length === 2)?.items.map(item => item.journalId)).toEqual([1, 2]);
    expect(queue.groups.every(group => group.items.every(item => /^[a-f0-9]{32}$/.test(item.reviewVersion)))).toBe(true);
    const first = await loadReviewGroups(2); const next = await loadReviewGroups(2, first.nextCursor!);
    expect(first.hasMore).toBe(true); expect(next.groups.some(group => first.groups.some(prior => prior.key === group.key))).toBe(false);
  });
  it('confirms exactly the frozen preview, learns once, and never adds a newly arriving payment', async () => {
    await seed(1); await seed(2);
    const group = (await loadReviewGroups()).groups[0];
    const ledger = (await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows;
    await seed(3);
    const result = await decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: true });
    expect(result).toMatchObject({ success: true, appliedCount: 2, remembered: true, journalIds: [1, 2] });
    expect(await rows()).toEqual([
      { id: 1, category_id: 2, status: 'reviewed', source: 'user' }, { id: 2, category_id: 2, status: 'reviewed', source: 'user' },
      { id: 3, category_id: null, status: 'needs_review', source: 'ai' },
    ]);
    expect((await fixture.query('SELECT context_key,category_id FROM categorization_learning')).rows).toEqual([{ context_key: group.key, category_id: 2 }]);
    expect((await fixture.query('SELECT * FROM book_entries WHERE journal_entry_id IN (1,2) ORDER BY id')).rows).toEqual(ledger);
  });
  it('rejects a changed suggestion version even when the journal snapshot is unchanged, without partial writes', async () => {
    await seed(1); await seed(2); const group = (await loadReviewGroups()).groups[0];
    await fixture.query("UPDATE transaction_categorizations SET reason='New evidence' WHERE journal_entry_id=2");
    await expect(decideReviewGroup({ ...selection(group), action: 'accept', remember: false })).rejects.toBeInstanceOf(CategorizationConflictError);
    expect((await rows()).every(row => row.category_id === null && row.status === 'needs_review')).toBe(true);
  });
  it('rechecks every member at final write after a read/write race and applies none if one changed', async () => {
    await seed(1); await seed(2); const group = (await loadReviewGroups()).groups[0];
    beforeWrite = async () => { await fixture.query("UPDATE transaction_categorizations SET reason='Changed after read' WHERE journal_entry_id=2"); };
    await expect(decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: true })).rejects.toBeInstanceOf(CategorizationConflictError);
    expect((await rows()).every(row => row.category_id === null && row.status === 'needs_review')).toBe(true);
    expect((await fixture.query('SELECT count(*) FROM categorization_learning')).rows[0].count).toBe('0');
  });
  it('never lets a caller combine different account contexts under one group key', async () => {
    await seed(1); await seed(2, { accountId: 21 }); const queue = await loadReviewGroups();
    const group = queue.groups[0]; const other = queue.groups[1];
    await expect(decideReviewGroup({ ...selection(group), items: [...selection(group).items, ...selection(other).items], action: 'correct', categoryId: 2, remember: false })).rejects.toBeInstanceOf(CategorizationConflictError);
    expect((await rows()).every(row => row.category_id === null)).toBe(true);
  });
  it('preserves a human review that commits after the group was read and rejects the rest of the group', async () => {
    await seed(1); await seed(2); const group = (await loadReviewGroups()).groups[0];
    beforeWrite = async () => { await fixture.query("UPDATE journal_entries SET category_id=3 WHERE id=2; UPDATE transaction_categorizations SET category_id=3,status='reviewed',source='user' WHERE journal_entry_id=2"); };
    await expect(decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: true })).rejects.toBeInstanceOf(CategorizationConflictError);
    expect(await rows()).toEqual([{ id: 1, category_id: null, status: 'needs_review', source: 'ai' }, { id: 2, category_id: 3, status: 'reviewed', source: 'user' }]);
    expect((await fixture.query('SELECT count(*) FROM categorization_learning')).rows[0].count).toBe('0');
  });
  it('requires an explicit correction if same-context suggestions disagree', async () => {
    await seed(1); await seed(2, { categoryId: 2 }); const group = (await loadReviewGroups()).groups[0];
    await expect(decideReviewGroup({ ...selection(group), action: 'accept', remember: false })).rejects.toBeInstanceOf(InvalidCategorizationError);
    expect((await decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: false })).appliedCount).toBe(2);
  });
  it('dismisses only selected reviews without changing ledger categories or learning', async () => {
    await seed(1); await seed(2); const group = (await loadReviewGroups()).groups[0];
    await fixture.query('INSERT INTO categorization_learning(context_key,category_id) VALUES($1,3)', [group.key]);
    await decideReviewGroup({ ...selection(group), action: 'dismiss', remember: false });
    expect((await rows()).every(row => row.category_id === null && row.status === 'dismissed')).toBe(true);
    expect((await fixture.query('SELECT category_id FROM categorization_learning')).rows).toEqual([{ category_id: 3 }]);
    await expect(decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: false })).rejects.toBeInstanceOf(CategorizationConflictError);
  });
  it('retires a conflicting saved exact category during an unremembered correction', async () => {
    await seed(1); const group = (await loadReviewGroups()).groups[0];
    await fixture.query('INSERT INTO categorization_learning(context_key,category_id) VALUES($1,3)', [group.key]);
    await decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: false });
    expect((await fixture.query('SELECT count(*) FROM categorization_learning')).rows[0].count).toBe('0');
  });
  it('invalidates a conflicting private meaning and its active aliases in the same group correction', async () => {
    await seed(1); await seed(2);
    await fixture.query("UPDATE journal_entries SET category_id=1 WHERE id=1; UPDATE transaction_categorizations SET category_id=1,status='reviewed',source='user' WHERE journal_entry_id=1");
    const id = '6344f29f-8726-4b08-8cd8-4c10be613c56';
    await fixture.query("INSERT INTO categorization_payee_memories(id,scope_key,account_id,owner_id,account_type,direction,currency,payee_name,category_id,identity_kind,source_journal_id) VALUES($1,'scope',11,1,'ASSET',-1,'GBP','Synthetic service',1,'description',1)", [id]);
    await fixture.query("INSERT INTO categorization_payee_aliases(memory_id,scope_key,identity_kind,normalized_alias,display_alias) VALUES($1,'scope','description','synthetic service','SYNTHETIC SERVICE')", [id]);
    const group = (await loadReviewGroups()).groups[0];
    await decideReviewGroup({ ...selection(group), action: 'correct', categoryId: 2, remember: true });
    expect((await fixture.query('SELECT status,revision FROM categorization_payee_memories WHERE id=$1', [id])).rows[0]).toEqual({ status: 'conflicted', revision: 2 });
    expect((await fixture.query('SELECT active FROM categorization_payee_aliases WHERE memory_id=$1', [id])).rows[0].active).toBe(false);
  });
  it('caps a large group at 100 previewed members and leaves all additional members queued', async () => {
    for (let id = 1; id <= 101; id++) await seed(id);
    const group = (await loadReviewGroups()).groups[0];
    expect(group).toMatchObject({ paymentCount: 101, hasMore: true }); expect(group.items).toHaveLength(100);
    expect((await decideReviewGroup({ ...selection(group), action: 'accept', remember: false })).appliedCount).toBe(100);
    expect(await loadReviewGroups()).toMatchObject({ totalPayments: 1, totalGroups: 1, groups: [{ paymentCount: 1, hasMore: false }] });
  });
  it('serializes simultaneous group decisions without mixing the chosen category', async () => {
    await seed(1); await seed(2); const group = (await loadReviewGroups()).groups[0];
    const result = await Promise.allSettled([2, 3].map(categoryId => decideReviewGroup({ ...selection(group), action: 'correct', categoryId, remember: false })));
    expect(result.filter(value => value.status === 'fulfilled')).toHaveLength(1);
    const saved = await rows(); expect(new Set(saved.map(row => row.category_id)).size).toBe(1);
    expect(saved.every(row => row.status === 'reviewed')).toBe(true);
  });
});
