import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationCandidate, CategorizationDecision } from './types';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { categorizationRepo } from './repository';
import { CategorizationConflictError, InvalidCategorizationError, confirmedCategorize, decideReview, getCategorizationRecords, loadReviewQueue } from './review';
import { categorizationContextKey, confirmedContextReviewReason, PAYEE_MEANINGS_CONFLICT_REASON } from './decisions';

const url = process.env.DATA_PLAN_TEST_PG_URL;

// Only synthetic records in a randomly named schema are used. Two real
// PostgreSQL sessions exercise locking and conflict handling, rather than
// asserting the shape of a mocked SQL statement.
describe.skipIf(!url)('categorisation persistence in disposable PostgreSQL', () => {
  const testSchema = `categorization_test_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;
  let race: { arrived: number; pids: Set<number>; ready: Promise<void>; release: () => void } | null = null;
  let onPersistenceConnection: ((pid: number) => void) | null = null;

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${testSchema}"`);
    await fixture.query(`SET search_path TO "${testSchema}", public`);
    await fixture.query(`
      CREATE TABLE categories (id integer PRIMARY KEY, name text NOT NULL, parent_id integer);
      CREATE TYPE account_type AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE');
      CREATE TABLE accounts (id integer PRIMARY KEY, name text NOT NULL, account_type account_type NOT NULL, owner_id integer);
      CREATE TABLE journal_entries (
        id integer PRIMARY KEY, date text NOT NULL, description text NOT NULL,
        reference text, property_id integer, category_id integer REFERENCES categories(id),
        is_transfer boolean NOT NULL DEFAULT false, transfer_group_id uuid,
        transfer_partner_journal_id integer, sync_run_id integer
      );
      CREATE TABLE book_entries (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_entry_id integer NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
        account_id integer NOT NULL REFERENCES accounts(id), amount numeric(14,2) NOT NULL
      );
      CREATE TABLE transaction_metadata (
        journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id) ON DELETE CASCADE,
        merchant_name text, bank_category text, transaction_type text, currency text
      );
      CREATE TABLE transaction_categorizations (
        journal_entry_id integer PRIMARY KEY REFERENCES journal_entries(id) ON DELETE CASCADE,
        snapshot_hash text NOT NULL, context_key text NOT NULL,
        category_id integer REFERENCES categories(id), confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
        reason text NOT NULL, evidence jsonb, source text NOT NULL CHECK (source IN ('rule','learned','ai','user')),
        status text NOT NULL CHECK (status IN ('applied','needs_review','reviewed','dismissed')),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE categorization_learning (
        context_key text PRIMARY KEY, category_id integer NOT NULL REFERENCES categories(id),
        created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE categorization_processing_lease (
        id integer PRIMARY KEY CHECK (id = 1), token uuid NOT NULL,
        expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    const migration = await readFile(new URL('../db/migration.sql', import.meta.url), 'utf8');
    const privatePayees = migration.indexOf('-- Private confirmed payee meanings.');
    if (privatePayees < 0) throw new Error('Missing private payee migration.');
    await fixture.query(migration.slice(privatePayees));
    pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${testSchema},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(async (statement: SQL) => {
      const { sql, params } = dialect.sqlToQuery(statement);
      if (/\bWITH\s+(?:proposed|locked)\s+AS\b/i.test(sql) && (race || onPersistenceConnection)) {
        const shared = race;
        const connection = await pool.connect();
        try {
          const pid = (await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
          onPersistenceConnection?.(pid);
          if (shared) {
            shared.pids.add(pid);
            shared.arrived += 1;
            if (shared.arrived === 2) shared.release();
            await shared.ready;
          }
          return await connection.query(sql, params);
        } finally { connection.release(); }
      }
      return pool.query(sql, params);
    });
  });

  afterAll(async () => {
    race?.release();
    await pool?.end();
    if (fixture) {
      await fixture.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await fixture.end();
    }
  });

  beforeEach(async () => {
    race = null;
    onPersistenceConnection = null;
    mocks.execute.mockClear();
    await fixture.query(`
      TRUNCATE categorization_learning, transaction_categorizations, transaction_metadata,
        book_entries, journal_entries, categories, accounts, categorization_processing_lease RESTART IDENTITY CASCADE;
      INSERT INTO categories(id,name) VALUES (1, 'Groceries'), (2, 'Shopping'), (3, 'Salary');
      INSERT INTO accounts VALUES (1, 'Shared current account', 'ASSET', NULL),
        (2, 'Recorded expense', 'EXPENSE', NULL), (3, 'Recorded income', 'INCOME', NULL),
        (4, 'Investment adjustment', 'EQUITY', NULL), (5, 'Other person account', 'ASSET', 42);
      INSERT INTO journal_entries(id,date,description,property_id,sync_run_id) VALUES
        (1,'2026-10-10','Example supermarket',7,77), (2,'2026-10-10','Example supermarket',NULL,78);
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES
        (1,1,-12.34),(1,2,12.34),(2,5,-56.78),(2,2,56.78);
      INSERT INTO transaction_metadata(journal_entry_id,merchant_name,bank_category,transaction_type,currency) VALUES
        (1,'Example merchant','groceries','card','GBP'), (2,'Example merchant','shopping','card','GBP');
    `);
  });

  const candidate = async (id = 1) => (await categorizationRepo.listCandidates({ journalIds: [id] }))[0];
  const decision = (entry: CategorizationCandidate, overrides: Partial<CategorizationDecision> = {}): CategorizationDecision => ({
    journalId: entry.id, categoryId: 1, confidence: 0.95, reason: 'Synthetic supermarket evidence.',
    source: 'ai', status: 'applied', ...overrides,
  });
  const rawJournal = async (id = 1) => (await fixture.query('SELECT * FROM journal_entries WHERE id=$1', [id])).rows[0];
  const rawDecision = async (id = 1) => (await fixture.query('SELECT * FROM transaction_categorizations WHERE journal_entry_id=$1', [id])).rows[0];
  const publicEvidence = (): MerchantResearchResult => ({
    status: 'matched', query: 'Example merchant business merchant',
    sources: [{ title: 'Synthetic public business source', url: 'https://www.tesco.com/', snippet: 'Synthetic public merchant identity fixture.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
    researchedAt: '2026-10-24T12:00:00.000Z', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
  });

  it('excludes transfers, unresolved pairs, future postings, existing categories and equity adjustments', async () => {
    await fixture.query(`
      INSERT INTO journal_entries(id,date,description,is_transfer,transfer_group_id,transfer_partner_journal_id,category_id) VALUES
        (3,'2026-10-10','Confirmed transfer',true,NULL,NULL,NULL),
        (4,'2026-10-10','Pending pair',false,'00000000-0000-0000-0000-000000000004',NULL,NULL),
        (5,'2026-10-10','Partner pointer',false,NULL,3,NULL),
        (6,'2026-10-10','User categorised',false,NULL,NULL,2),
        (7,'2099-01-01','Future posting',false,NULL,NULL,NULL),
        (8,'2026-10-10','Opening valuation',false,NULL,NULL,NULL);
      INSERT INTO book_entries(journal_entry_id,account_id,amount)
        SELECT id,1,-10 FROM journal_entries WHERE id>=3;
      INSERT INTO book_entries(journal_entry_id,account_id,amount)
        SELECT id,CASE WHEN id=8 THEN 4 ELSE 2 END,10 FROM journal_entries WHERE id>=3;
    `);
    expect((await categorizationRepo.listCandidates()).map(entry => entry.id).sort()).toEqual([1, 2]);
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 2, available: 2, needsReview: 0 });
    expect(await categorizationRepo.listCandidates({ journalIds: [] })).toEqual([]);
    expect((await categorizationRepo.listCandidates({ syncRunIds: [77] })).map(entry => entry.id)).toEqual([1]);
  });

  it('keeps durable processing inside its start snapshot while reporting the current global backlog', async () => {
    expect((await categorizationRepo.listCandidates({ maxJournalId: 1 })).map(entry => entry.id)).toEqual([1]);
    expect(await categorizationRepo.counts({ maxJournalId: 1 })).toMatchObject({ available: 2, scopeAvailable: 1 });
    expect(await categorizationRepo.listCandidates({ maxJournalId: 0 })).toEqual([]);
  });

  it('atomically records provenance and changes only the category while retaining signs, ownership and property links', async () => {
    const entry = await candidate();
    const before = await rawJournal();
    const beforeLegs = (await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows;
    const beforeAccounts = (await fixture.query('SELECT * FROM accounts ORDER BY id')).rows;
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)])).toEqual([{ journalId: 1, status: 'applied' }]);
    expect(await rawJournal()).toEqual({ ...before, category_id: 1 });
    expect((await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows).toEqual(beforeLegs);
    expect((await fixture.query('SELECT * FROM accounts ORDER BY id')).rows).toEqual(beforeAccounts);
    expect(await rawDecision()).toMatchObject({ snapshot_hash: entry.snapshot, category_id: 1, confidence: '0.9500', source: 'ai', status: 'applied' });
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 1, available: 1, needsReview: 0 });
  });

  it('queues uncertainty without booking a category and excludes the unchanged suggestion from repeat processing', async () => {
    const entry = await candidate();
    const suggestion = decision(entry, { categoryId: null, confidence: 0.2, status: 'needs_review' });
    expect(await categorizationRepo.persistDecisions([entry], [suggestion])).toEqual([{ journalId: 1, status: 'needs_review' }]);
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toMatchObject({ category_id: null, status: 'needs_review' });
    expect(await categorizationRepo.listCandidates({ journalIds: [1] })).toEqual([]);
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 2, available: 1, needsReview: 1 });
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)])).toEqual([]);
    expect((await rawJournal()).category_id).toBeNull();
  });

  it('stores actual public citations atomically with a category without learning merchant rules', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { evidence: publicEvidence() })]);
    expect((await rawDecision()).evidence).toEqual(publicEvidence());
    expect((await rawJournal()).category_id).toBe(1);
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
  });

  it.each(['accept', 'correct', 'dismiss'] as const)('retains public citations when a user chooses %s', async action => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.6, status: 'needs_review', evidence: publicEvidence() })]);
    expect((await loadReviewQueue()).items[0].evidence).toEqual(publicEvidence());
    await decideReview({ journalId: 1, snapshot: entry.snapshot, action, remember: false, ...(action === 'correct' ? { categoryId: 2 } : {}) });
    expect((await rawDecision()).evidence).toEqual(publicEvidence());
    expect((await rawDecision()).source).toBe('user');
    expect((await rawJournal()).category_id).toBe(action === 'dismiss' ? null : action === 'correct' ? 2 : 1);
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
  });

  it('discards stale public provenance when a manual correction follows changed transaction context', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.6, status: 'needs_review', evidence: publicEvidence() })]);
    await fixture.query("UPDATE transaction_metadata SET merchant_name = 'Different merchant' WHERE journal_entry_id = 1");
    const [current] = await getCategorizationRecords([1]);
    await confirmedCategorize({ journalId: 1, categoryId: 2, snapshot: current.snapshot });
    expect((await rawDecision()).evidence).toBeNull();
  });

  it('rejects malformed public provenance before applying any category', async () => {
    const entry = await candidate();
    await expect(categorizationRepo.persistDecisions([entry], [decision(entry, { evidence: { ...publicEvidence(), sources: [] } })])).rejects.toThrow('actual public merchant sources');
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toBeUndefined();
  });

  it('never exposes unsafe historical evidence in the review queue', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.6, status: 'needs_review', evidence: publicEvidence() })]);
    await fixture.query(`UPDATE transaction_categorizations SET evidence = jsonb_set(evidence, '{sources,0,url}', '"javascript:alert(1)"'::jsonb)`);
    expect((await loadReviewQueue()).items[0].evidence).toBeNull();
  });

  it('rolls back the category if the public provenance database write fails', async () => {
    const entry = await candidate();
    await fixture.query('ALTER TABLE transaction_categorizations ADD CONSTRAINT reject_test_evidence CHECK (evidence IS NULL)');
    try {
      await expect(categorizationRepo.persistDecisions([entry], [decision(entry, { evidence: publicEvidence() })])).rejects.toThrow();
      expect((await rawJournal()).category_id).toBeNull();
      expect(await rawDecision()).toBeUndefined();
    } finally {
      await fixture.query('ALTER TABLE transaction_categorizations DROP CONSTRAINT reject_test_evidence');
    }
  });

  it.each([
    ['manual category', 'UPDATE journal_entries SET category_id=2 WHERE id=1'],
    ['confirmed transfer', "UPDATE journal_entries SET is_transfer=true WHERE id=1"],
    ['pending transfer pair', "UPDATE journal_entries SET transfer_group_id='00000000-0000-0000-0000-000000000001' WHERE id=1"],
    ['partner transfer pointer', 'UPDATE journal_entries SET transfer_partner_journal_id=2 WHERE id=1'],
    ['description', "UPDATE journal_entries SET description='User corrected description' WHERE id=1"],
    ['date', "UPDATE journal_entries SET date='2026-10-09' WHERE id=1"],
    ['reference', "UPDATE journal_entries SET reference='New reference' WHERE id=1"],
    ['property attribution', 'UPDATE journal_entries SET property_id=8 WHERE id=1'],
    ['merchant metadata', "UPDATE transaction_metadata SET merchant_name='Changed merchant' WHERE journal_entry_id=1"],
    ['bank hint', "UPDATE transaction_metadata SET bank_category='Changed hint' WHERE journal_entry_id=1"],
    ['currency', "UPDATE transaction_metadata SET currency='EUR' WHERE journal_entry_id=1"],
    ['account owner', 'UPDATE accounts SET owner_id=7 WHERE id=1'],
    ['account type', "UPDATE accounts SET account_type='LIABILITY' WHERE id=1"],
    ['ledger amount', 'UPDATE book_entries SET amount=amount+1 WHERE journal_entry_id=1'],
    ['deleted journal', 'DELETE FROM journal_entries WHERE id=1'],
  ])('rejects an in-flight decision after changed %s without recording false success', async (_name, mutation) => {
    const entry = await candidate();
    await fixture.query(mutation);
    const changed = await rawJournal();
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)])).toEqual([]);
    expect(await rawJournal()).toEqual(changed);
    expect(await rawDecision()).toBeUndefined();
  });

  it.each(['dismissed', 'reviewed'])('cannot replace a user %s decision read after the model started', async status => {
    const entry = await candidate();
    await fixture.query(`INSERT INTO transaction_categorizations
      (journal_entry_id,snapshot_hash,context_key,category_id,confidence,reason,source,status)
      VALUES (1,$1,'reviewed-context',NULL,0,'User decision','user',$2)`, [entry.snapshot, status]);
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)])).toEqual([]);
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toMatchObject({ source: 'user', status, reason: 'User decision' });
  });

  it('refreshes an old unresolved suggestion only after its evidence changes', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.3, status: 'needs_review' })]);
    await fixture.query("UPDATE transaction_metadata SET merchant_name='Updated source' WHERE journal_entry_id=1");
    const updated = await candidate();
    expect(updated.snapshot).not.toBe(entry.snapshot);
    expect(await categorizationRepo.persistDecisions([updated], [decision(updated)])).toEqual([{ journalId: 1, status: 'applied' }]);
    expect(await rawDecision()).toMatchObject({ snapshot_hash: updated.snapshot, status: 'applied' });
  });

  it('rejects a foreign category and rolls back a failed provenance constraint without a category write', async () => {
    const entry = await candidate();
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry, { categoryId: 999 })])).toEqual([]);
    expect(await rawDecision()).toBeUndefined();
    await expect(categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 2 })])).rejects.toThrow();
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toBeUndefined();
  });

  it('allows exactly one of two simultaneous classifications of an uncategorised journal', async () => {
    const entry = await candidate();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const shared = { arrived: 0, pids: new Set<number>(), ready, release };
    race = shared;
    const timeout = setTimeout(release, 3000);
    try {
      const outcomes = await Promise.all([
        categorizationRepo.persistDecisions([entry], [decision(entry)]),
        categorizationRepo.persistDecisions([entry], [decision(entry, { categoryId: 2 })]),
      ]);
      expect(shared.arrived).toBe(2);
      expect(shared.pids.size).toBe(2);
      expect(outcomes.filter(rows => rows.length === 1)).toHaveLength(1);
      expect(outcomes.filter(rows => rows.length === 0)).toHaveLength(1);
      expect((await rawDecision()).category_id).toBe((await rawJournal()).category_id);
    } finally {
      clearTimeout(timeout);
      release();
      race = null;
    }
  });

  it('waits for a simultaneous manual category correction and cannot overwrite it', async () => {
    const entry = await candidate();
    await fixture.query('BEGIN');
    await fixture.query('UPDATE journal_entries SET category_id=2 WHERE id=1');
    let signal!: (pid: number) => void;
    const connected = new Promise<number>(resolve => { signal = resolve; });
    onPersistenceConnection = signal;
    const automatic = categorizationRepo.persistDecisions([entry], [decision(entry)]);
    const pid = await connected;
    let actuallyBlocked = false;
    try {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await fixture.query('SELECT pg_stat_clear_snapshot()');
        const result = await fixture.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [pid]);
        if (result.rows[0]?.wait_event_type === 'Lock') { actuallyBlocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    } finally {
      // Release even on an assertion failure so the fixture cannot hang.
      await fixture.query('COMMIT');
      onPersistenceConnection = null;
    }
    expect(actuallyBlocked).toBe(true);
    expect(await automatic).toEqual([]);
    expect((await rawJournal()).category_id).toBe(2);
    expect(await rawDecision()).toBeUndefined();
  });

  it('uses one shared lease, rejects expired tokens, and prevents a stale release from deleting a successor lease', async () => {
    const first = randomUUID();
    const second = randomUUID();
    const results = await Promise.all([categorizationRepo.acquireLease(first), categorizationRepo.acquireLease(second)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const winner = results[0] ? first : second;
    const loser = results[0] ? second : first;
    await categorizationRepo.releaseLease(loser);
    expect((await fixture.query('SELECT token FROM categorization_processing_lease')).rows).toEqual([{ token: winner }]);
    const entry = await candidate();
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)], loser)).toEqual([]);
    await fixture.query("UPDATE categorization_processing_lease SET expires_at=now()-interval '1 second'");
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)], winner)).toEqual([]);
    expect(await categorizationRepo.acquireLease(loser)).toBe(true);
    await categorizationRepo.releaseLease(winner);
    expect((await fixture.query('SELECT token FROM categorization_processing_lease')).rows).toEqual([{ token: loser }]);
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)], loser)).toEqual([{ journalId: 1, status: 'applied' }]);
  });

  it('accepts a reviewed suggestion atomically and learns only its explicitly confirmed transaction context', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.7, status: 'needs_review' })]);
    const queue = await loadReviewQueue();
    expect(queue.total).toBe(1);
    expect(queue.items[0]).toMatchObject({ journalId: 1, suggestedCategoryId: 1, confidence: 0.7, snapshot: entry.snapshot });
    expect(await decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'accept', remember: true })).toMatchObject({ success: true, categoryId: 1, remembered: true });
    expect(await rawDecision()).toMatchObject({ source: 'user', status: 'reviewed', confidence: null, category_id: 1 });
    expect((await rawJournal()).category_id).toBe(1);
    const key = categorizationContextKey(entry);
    expect(await categorizationRepo.lookupLearned([key])).toEqual(new Map([[key, 1]]));
    expect(await categorizationRepo.lookupLearned([categorizationContextKey((await categorizationRepo.listCandidates({ journalIds: [2] }))[0])])).toEqual(new Map());
    expect((await loadReviewQueue()).total).toBe(0);
    await expect(decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'accept', remember: true })).rejects.toBeInstanceOf(CategorizationConflictError);
  });

  it('corrects an unknown suggestion while preserving amount signs and learning only when opted in', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { categoryId: null, confidence: 0.1, status: 'needs_review' })]);
    await expect(decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'accept', remember: false })).rejects.toBeInstanceOf(InvalidCategorizationError);
    expect(await decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'correct', categoryId: 2, remember: false })).toMatchObject({ categoryId: 2, remembered: false });
    expect((await rawJournal()).category_id).toBe(2);
    expect((await fixture.query('SELECT amount::text FROM book_entries WHERE journal_entry_id=1 ORDER BY id')).rows).toEqual([{ amount: '-12.34' }, { amount: '12.34' }]);
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
  });

  it('dismisses uncertainty without categorising it or learning a guessed mapping', async () => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.2, status: 'needs_review' })]);
    expect(await decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'dismiss', remember: false })).toMatchObject({ success: true, categoryId: null, remembered: false });
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toMatchObject({ source: 'user', status: 'dismissed', category_id: null, confidence: null });
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
    expect(await categorizationRepo.persistDecisions([entry], [decision(entry)])).toEqual([]);
  });

  it('guards explicit manual corrections against stale categories and creates provenance with no inferred property changes', async () => {
    const [record] = await getCategorizationRecords([1]);
    expect(await confirmedCategorize({ journalId: 1, categoryId: 2, snapshot: record.snapshot, remember: false })).toEqual({ journalId: 1, categoryId: 2, remembered: false });
    expect(await rawJournal()).toMatchObject({ category_id: 2, property_id: 7, is_transfer: false });
    await expect(confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: record.snapshot })).rejects.toBeInstanceOf(CategorizationConflictError);
    const [current] = await getCategorizationRecords([1]);
    expect(current.snapshot).not.toBe(record.snapshot);
    expect(await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: current.snapshot, remember: true })).toMatchObject({ categoryId: 1, remembered: true });
    expect(await rawDecision()).toMatchObject({ source: 'user', status: 'reviewed', category_id: 1, confidence: null });
  });

  it('forgets an older conflicting exact match when a later manual correction is not remembered', async () => {
    const entry = await candidate(1);
    const key = categorizationContextKey(entry);
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: entry.snapshot, remember: true });
    await fixture.query("INSERT INTO categorization_learning(context_key,category_id) VALUES ('unrelated-confirmation',1)");
    const [current] = await getCategorizationRecords([1]);
    expect(await confirmedCategorize({ journalId: 1, categoryId: 2, snapshot: current.snapshot, remember: false })).toMatchObject({ categoryId: 2, remembered: false });
    expect((await categorizationRepo.lookupLearned([key])).has(key)).toBe(false);
    expect(await categorizationRepo.lookupLearned(['unrelated-confirmation'])).toEqual(new Map([['unrelated-confirmation', 1]]));
    expect((await rawJournal(1)).category_id).toBe(2);
  });

  it('keeps an existing consistent exact match when the user confirms that category without remembering again', async () => {
    const entry = await candidate(1);
    const key = categorizationContextKey(entry);
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: entry.snapshot, remember: true });
    const [current] = await getCategorizationRecords([1]);
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: current.snapshot, remember: false });
    expect(await categorizationRepo.lookupLearned([key])).toEqual(new Map([[key, 1]]));
  });

  it.each(['correct', 'dismiss'] as const)('retires conflicting exact learning only for a confirmed review correction, not a %s dismissal', async action => {
    const entry = await candidate(1);
    const key = categorizationContextKey(entry);
    await fixture.query('INSERT INTO categorization_learning(context_key,category_id) VALUES ($1,1)', [key]);
    await categorizationRepo.persistDecisions([entry], [decision(entry, { source: 'learned', confidence: 1, status: 'needs_review' })]);
    await decideReview({ journalId: 1, snapshot: entry.snapshot, action, remember: false, ...(action === 'correct' ? { categoryId: 2 } : {}) });
    const learned = await categorizationRepo.lookupLearned([key]);
    expect(learned.has(key)).toBe(action === 'dismiss');
    expect((await rawJournal(1)).category_id).toBe(action === 'correct' ? 2 : null);
  });

  it.each([
    ['metadata', "UPDATE transaction_metadata SET merchant_name='Changed after queue load' WHERE journal_entry_id=1"],
    ['manual category', 'UPDATE journal_entries SET category_id=2 WHERE id=1'],
    ['transfer', 'UPDATE journal_entries SET is_transfer=true WHERE id=1'],
    ['pending group', "UPDATE journal_entries SET transfer_group_id='00000000-0000-0000-0000-000000000001' WHERE id=1"],
    ['ledger amount', 'UPDATE book_entries SET amount=amount+1 WHERE journal_entry_id=1'],
    ['account owner', 'UPDATE accounts SET owner_id=7 WHERE id=1'],
  ])('rejects review after changed %s without learning stale evidence', async (_name, mutation) => {
    const entry = await candidate();
    await categorizationRepo.persistDecisions([entry], [decision(entry, { confidence: 0.5, status: 'needs_review' })]);
    await fixture.query(mutation);
    const changed = await rawJournal();
    await expect(decideReview({ journalId: 1, snapshot: entry.snapshot, action: 'correct', categoryId: 1, remember: true })).rejects.toBeInstanceOf(CategorizationConflictError);
    expect(await rawJournal()).toEqual(changed);
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
  });

  it('rejects missing journals and unknown confirmed categories before changing category, provenance or learning', async () => {
    const entry = await candidate();
    await expect(confirmedCategorize({ journalId: 999, categoryId: 1, snapshot: entry.snapshot, remember: true })).rejects.toBeInstanceOf(CategorizationConflictError);
    await expect(confirmedCategorize({ journalId: 1, categoryId: 999, snapshot: entry.snapshot, remember: true })).rejects.toBeInstanceOf(InvalidCategorizationError);
    expect((await rawJournal()).category_id).toBeNull();
    expect(await rawDecision()).toBeUndefined();
    expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
  });

  it('does not reuse a learned category across a reversed cash direction or another account owner', async () => {
    const entry = await candidate();
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: entry.snapshot, remember: true });
    await fixture.query(`
      INSERT INTO journal_entries(id,date,description,property_id) VALUES
        (3,'2026-10-10','Example supermarket',7), (4,'2026-10-10','Example supermarket',7),
        (5,'2026-10-10','Example supermarket',7);
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES
        (3,1,12.34),(3,2,-12.34),(4,5,-12.34),(4,2,12.34),(5,1,-99),(5,2,99);
      INSERT INTO transaction_metadata(journal_entry_id,merchant_name,bank_category,transaction_type,currency)
        SELECT id,'Example merchant','groceries','card','GBP' FROM journal_entries WHERE id>=3;
    `);
    const candidates = await categorizationRepo.listCandidates({ journalIds: [3, 4, 5] });
    const keys = candidates.map(categorizationContextKey);
    const learned = await categorizationRepo.lookupLearned(keys);
    expect(learned.has(categorizationContextKey(candidates.find(record => record.id === 3)!))).toBe(false);
    expect(learned.has(categorizationContextKey(candidates.find(record => record.id === 4)!))).toBe(false);
    expect(learned.get(categorizationContextKey(candidates.find(record => record.id === 5)!))).toBe(1);
  });

  it('atomically rolls back a failed manual provenance write including optional learning', async () => {
    const entry = await candidate();
    await fixture.query("ALTER TABLE transaction_categorizations ADD CONSTRAINT reject_synthetic_manual CHECK (source <> 'user')");
    try {
      await expect(confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: entry.snapshot, remember: true })).rejects.toThrow();
      expect((await rawJournal()).category_id).toBeNull();
      expect(await rawDecision()).toBeUndefined();
      expect((await fixture.query('SELECT * FROM categorization_learning')).rows).toEqual([]);
    } finally {
      await fixture.query('ALTER TABLE transaction_categorizations DROP CONSTRAINT reject_synthetic_manual');
    }
  });

  it('allows only one of two simultaneous user corrections with the same old snapshot', async () => {
    const entry = await candidate();
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const shared = { arrived: 0, pids: new Set<number>(), ready, release };
    race = shared;
    const timeout = setTimeout(release, 3000);
    try {
      const outcomes = await Promise.allSettled([
        confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: entry.snapshot, remember: true }),
        confirmedCategorize({ journalId: 1, categoryId: 2, snapshot: entry.snapshot, remember: true }),
      ]);
      expect(shared.arrived).toBe(2);
      expect(shared.pids.size).toBe(2);
      expect(outcomes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
      const failed = outcomes.find(result => result.status === 'rejected');
      expect(failed?.status === 'rejected' ? failed.reason : null).toBeInstanceOf(CategorizationConflictError);
      const committed = (await rawJournal()).category_id;
      expect((await rawDecision()).category_id).toBe(committed);
      expect((await categorizationRepo.lookupLearned([categorizationContextKey(entry)])).get(categorizationContextKey(entry))).toBe(committed);
    } finally {
      clearTimeout(timeout);
      release();
      race = null;
    }
  });

  it('paginates only current review items and keeps exact counts independent of page size', async () => {
    const candidates = await categorizationRepo.listCandidates();
    await categorizationRepo.persistDecisions(candidates, candidates.map(entry => decision(entry, { confidence: 0.5, status: 'needs_review' })));
    const first = await loadReviewQueue(1);
    expect(first.total).toBe(2);
    expect(first.items.map(item => item.journalId)).toEqual([1]);
    expect(first.nextCursor).toBe(1);
    const second = await loadReviewQueue(1, first.nextCursor!);
    expect(second.total).toBe(2);
    expect(second.items.map(item => item.journalId)).toEqual([2]);
    expect(second.nextCursor).toBeNull();
    await fixture.query("UPDATE transaction_metadata SET bank_category='New evidence' WHERE journal_entry_id=1");
    expect((await loadReviewQueue(1)).total).toBe(1);
  });

  async function matchingPendingRecords() {
    await fixture.query(`
      UPDATE journal_entries SET property_id=7 WHERE id=2;
      UPDATE transaction_metadata SET bank_category='groceries' WHERE journal_entry_id=2;
      UPDATE book_entries SET account_id=1 WHERE journal_entry_id=2 AND account_id=5;
    `);
    const candidates = await categorizationRepo.listCandidates();
    expect(categorizationContextKey(candidates[0])).toBe(categorizationContextKey(candidates[1]));
    await categorizationRepo.persistDecisions(candidates, candidates.map(entry => decision(entry, { confidence: 0.5, status: 'needs_review' })));
    const first = candidates.find(entry => entry.id === 1)!;
    const second = candidates.find(entry => entry.id === 2)!;
    await decideReview({ journalId: 1, snapshot: first.snapshot, action: 'accept', remember: true });
    return second;
  }

  async function alignPrivatePayments() {
    await fixture.query(`
      UPDATE journal_entries SET property_id=7 WHERE id=2;
      UPDATE book_entries SET account_id=1 WHERE journal_entry_id=2 AND account_id=5;
      UPDATE transaction_metadata SET transaction_type='bank_transfer';
    `);
  }
  async function confirmedPrivatePayee() {
    const source = await candidate(1);
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: source.snapshot });
    const id = randomUUID();
    await fixture.query(`INSERT INTO categorization_payee_memories
      (id,scope_key,account_id,owner_id,account_type,direction,currency,property_id,payee_name,purpose,category_id,identity_kind,source_journal_id)
      VALUES ($1,'fixture-scope',1,NULL,'ASSET',-1,'GBP',7,'Known cleaner','Confirmed recurring service',1,'merchant',1)`, [id]);
    await fixture.query(`INSERT INTO categorization_payee_aliases(memory_id,scope_key,identity_kind,normalized_alias,display_alias)
      VALUES ($1,'fixture-scope','merchant','example merchant','Example merchant')`, [id]);
    return id;
  }

  it('resolves an unchanged review using current confirmed payee knowledge without changing ledger amounts', async () => {
    await alignPrivatePayments();
    const pending = await candidate(2);
    await categorizationRepo.persistDecisions([pending], [decision(pending, { confidence: 0.4, status: 'needs_review' })]);
    const memoryId = await confirmedPrivatePayee();
    const [reconsidered] = await categorizationRepo.listCandidates();
    expect(reconsidered.id).toBe(2);
    expect(reconsidered.pendingReview).toBe(true);
    expect(confirmedContextReviewReason(reconsidered, 1, [{ id: 1, name: 'Groceries' }])).toBeNull();
    const legs = (await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows;
    expect(await categorizationRepo.persistDecisions([reconsidered], [decision(reconsidered, {
      source: 'payee', confidence: 1, payeeMemoryId: memoryId, payeeMemoryRevision: 1,
    })])).toEqual([{ journalId: 2, status: 'applied' }]);
    expect(await rawDecision(2)).toMatchObject({ source: 'payee', payee_memory_id: memoryId, payee_memory_revision: 1 });
    expect((await fixture.query('SELECT * FROM book_entries ORDER BY id')).rows).toEqual(legs);
    expect(await categorizationRepo.counts()).toMatchObject({ available: 0, needsReview: 0 });
  });

  it('reconsiders the legacy bank-transfer-only review once when its exact context was explicitly remembered', async () => {
    await alignPrivatePayments();
    await fixture.query("UPDATE transaction_metadata SET bank_category='groceries' WHERE journal_entry_id=2");
    const source = await candidate(1);
    await confirmedCategorize({ journalId: 1, categoryId: 1, snapshot: source.snapshot, remember: true });
    const pending = await candidate(2);
    const reason = 'The bank metadata describes an account movement. Confirm whether it is spending, income or a transfer before categorising it.';
    await categorizationRepo.persistDecisions([pending], [decision(pending, { source: 'learned', confidence: 1, status: 'needs_review', reason })]);
    expect(await categorizationRepo.counts()).toMatchObject({ available: 1, needsReview: 1 });
    const [reconsidered] = await categorizationRepo.listCandidates();
    expect(confirmedContextReviewReason(reconsidered, 1, [{ id: 1, name: 'Groceries' }])).toBeNull();
    expect(await categorizationRepo.persistDecisions([reconsidered], [decision(reconsidered, { source: 'learned', confidence: 1 })])).toEqual([{ journalId: 2, status: 'applied' }]);
    expect(await categorizationRepo.counts()).toMatchObject({ available: 0, needsReview: 0 });
    expect(await categorizationRepo.listCandidates()).toEqual([]);
  });

  it.each(['disabled', 'revision', 'source'] as const)('rejects stale private payee decisions after a %s change', async change => {
    await alignPrivatePayments();
    const memoryId = await confirmedPrivatePayee();
    const pending = await candidate(2);
    if (change === 'disabled') await fixture.query("UPDATE categorization_payee_memories SET status='disabled' WHERE id=$1", [memoryId]);
    if (change === 'revision') await fixture.query('UPDATE categorization_payee_memories SET revision=2 WHERE id=$1', [memoryId]);
    if (change === 'source') await fixture.query('UPDATE journal_entries SET category_id=2 WHERE id=1');
    expect(await categorizationRepo.persistDecisions([pending], [decision(pending, {
      source: 'payee', confidence: 1, payeeMemoryId: memoryId, payeeMemoryRevision: 1,
    })])).toEqual([]);
    expect((await rawJournal(2)).category_id).toBeNull();
  });

  it('retires conflicting private knowledge atomically when a later payment is corrected', async () => {
    await alignPrivatePayments();
    const memoryId = await confirmedPrivatePayee();
    const pending = await candidate(2);
    await confirmedCategorize({ journalId: 2, categoryId: 2, snapshot: pending.snapshot });
    expect((await rawJournal(2)).category_id).toBe(2);
    expect((await fixture.query('SELECT status,revision FROM categorization_payee_memories WHERE id=$1', [memoryId])).rows[0]).toEqual({ status: 'conflicted', revision: 2 });
    expect((await fixture.query('SELECT active FROM categorization_payee_aliases WHERE memory_id=$1', [memoryId])).rows[0].active).toBe(false);
    expect(await rawDecision(2)).toMatchObject({ source: 'user', payee_memory_id: null, payee_memory_revision: null });
  });

  it('does not loop an unchanged private-meaning conflict and revisits it when one meaning remains', async () => {
    await alignPrivatePayments();
    const memoryId = await confirmedPrivatePayee();
    await fixture.query(`
      INSERT INTO journal_entries(id,date,description,property_id,category_id) VALUES (4,'2026-10-11','Example supermarket',7,2);
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES (4,1,-10),(4,2,10);
      INSERT INTO transaction_metadata(journal_entry_id,merchant_name,bank_category,transaction_type,currency) VALUES (4,'Example merchant','shopping','bank_transfer','GBP');
    `);
    const otherId = randomUUID();
    await fixture.query(`INSERT INTO categorization_payee_memories
      (id,scope_key,account_id,owner_id,account_type,direction,currency,property_id,payee_name,category_id,identity_kind,source_journal_id)
      VALUES ($1,'fixture-scope',1,NULL,'ASSET',-1,'GBP',7,'Other confirmed meaning',2,'description',4)`, [otherId]);
    await fixture.query(`INSERT INTO categorization_payee_aliases(memory_id,scope_key,identity_kind,normalized_alias,display_alias)
      VALUES ($1,'fixture-scope','description','example supermarket','Example supermarket')`, [otherId]);
    const pending = await candidate(2);
    await categorizationRepo.persistDecisions([pending], [decision(pending, {
      source: 'payee', categoryId: null, confidence: 1, status: 'needs_review', reason: PAYEE_MEANINGS_CONFLICT_REASON,
      payeeMemoryId: memoryId, payeeMemoryRevision: 1,
    })]);
    expect(await categorizationRepo.listCandidates()).toEqual([]);
    expect(await categorizationRepo.counts()).toMatchObject({ available: 0, needsReview: 1 });
    await fixture.query("UPDATE categorization_payee_memories SET status='disabled', revision=2 WHERE id=$1", [otherId]);
    const [resolved] = await categorizationRepo.listCandidates();
    expect(resolved.id).toBe(2);
    expect(await categorizationRepo.persistDecisions([resolved], [decision(resolved, {
      source: 'payee', confidence: 1, payeeMemoryId: memoryId, payeeMemoryRevision: 1,
    })])).toEqual([{ journalId: 2, status: 'applied' }]);
    expect(await categorizationRepo.listCandidates()).toEqual([]);
  });

  it('reuses an opted-in confirmation for an existing identical-context question without another model guess', async () => {
    const second = await matchingPendingRecords();
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 1, available: 1, needsReview: 1 });
    expect((await categorizationRepo.listCandidates()).map(entry => entry.id)).toEqual([2]);
    expect(await categorizationRepo.persistDecisions([second], [decision(second, { source: 'learned', confidence: 1 })])).toEqual([{ journalId: 2, status: 'applied' }]);
    expect((await rawJournal(2)).category_id).toBe(1);
    expect(await rawDecision(2)).toMatchObject({ source: 'learned', status: 'applied', snapshot_hash: second.snapshot });
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 0, available: 0, needsReview: 0 });
  });

  it.each(['ai', 'rule'] as const)('does not let %s overwrite unchanged uncertainty merely because a learned mapping exists', async source => {
    const second = await matchingPendingRecords();
    expect(await categorizationRepo.persistDecisions([second], [decision(second, { source, confidence: 1 })])).toEqual([]);
    expect((await rawJournal(2)).category_id).toBeNull();
    expect(await rawDecision(2)).toMatchObject({ source: 'ai', status: 'needs_review', confidence: '0.5000' });
  });

  it.each([
    'DELETE FROM categorization_learning',
    'UPDATE categorization_learning SET category_id=2',
  ])('rejects a stale learned decision when the approved mapping changes: %s', async mutation => {
    const second = await matchingPendingRecords();
    await fixture.query(mutation);
    expect(await categorizationRepo.persistDecisions([second], [decision(second, { source: 'learned', confidence: 1 })])).toEqual([]);
    expect((await rawJournal(2)).category_id).toBeNull();
    expect(await rawDecision(2)).toMatchObject({ source: 'ai', status: 'needs_review', confidence: '0.5000' });
  });

  it('does not revive a dismissed matching question even when another confirmation can be reused', async () => {
    const second = await matchingPendingRecords();
    await decideReview({ journalId: 2, snapshot: second.snapshot, action: 'dismiss', remember: false });
    expect(await categorizationRepo.listCandidates()).toEqual([]);
    expect(await categorizationRepo.persistDecisions([second], [decision(second, { source: 'learned', confidence: 1 })])).toEqual([]);
    expect(await rawDecision(2)).toMatchObject({ source: 'user', status: 'dismissed' });
    expect((await rawJournal(2)).category_id).toBeNull();
  });

  it('refreshes a learned movement suggestion once while keeping the repayment or refund question unresolved', async () => {
    await fixture.query(`
      UPDATE accounts SET account_type='LIABILITY' WHERE id=1;
      UPDATE book_entries SET amount=CASE WHEN account_id=2 THEN -ABS(amount) ELSE ABS(amount) END;
    `);
    const second = await matchingPendingRecords();
    const cautious = decision(second, { source: 'learned', confidence: 1, status: 'needs_review' });
    expect(await categorizationRepo.persistDecisions([second], [cautious])).toEqual([{ journalId: 2, status: 'needs_review' }]);
    expect((await rawJournal(2)).category_id).toBeNull();
    expect(await rawDecision(2)).toMatchObject({ source: 'learned', status: 'needs_review' });
    expect(await categorizationRepo.listCandidates()).toEqual([]);
    expect(await categorizationRepo.counts()).toMatchObject({ remaining: 1, available: 0, needsReview: 1 });
    expect(await categorizationRepo.persistDecisions([second], [cautious])).toEqual([]);
  });
});
