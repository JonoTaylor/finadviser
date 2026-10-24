import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { loadLedgerCoverage, loadPropertyCoverage } from './load';

const url = process.env.DATA_PLAN_TEST_PG_URL;

// All objects are TEMP and shadow application tables only in this fixture's
// connection. No migration or production financial record is changed.
describe.skipIf(!url)('data intelligence coverage SQL in disposable PostgreSQL', () => {
  let client: Client;
  let queued: Promise<unknown> = Promise.resolve();
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text NOT NULL, account_type text NOT NULL, owner_id integer);
      CREATE TEMP TABLE journal_entries (
        id integer PRIMARY KEY, date text NOT NULL, description text NOT NULL, reference text,
        category_id integer, property_id integer, is_transfer boolean DEFAULT false,
        transfer_group_id uuid, transfer_partner_journal_id integer, transfer_review_dismissed_at timestamp,
        sync_run_id integer
      );
      CREATE TEMP TABLE book_entries (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, journal_entry_id integer, account_id integer, amount numeric(14,2));
      CREATE TEMP TABLE transaction_metadata (journal_entry_id integer PRIMARY KEY, merchant_name text, bank_category text, transaction_type text, currency text);
      CREATE TEMP TABLE transaction_categorizations (
        journal_entry_id integer PRIMARY KEY, snapshot_hash text, status text, context_key text, source text,
        category_id integer, reason text, updated_at timestamptz DEFAULT now(),
        payee_memory_id uuid, payee_memory_revision integer
      );
      CREATE TEMP TABLE categorization_learning (context_key text PRIMARY KEY, category_id integer, updated_at timestamptz DEFAULT now());
      -- TEMP fixture counterparts for the confirmed-knowledge eligibility query.
      -- No foreign keys to permanent application tables are introduced here.
      CREATE TEMP TABLE categorization_payee_memories (
        id uuid PRIMARY KEY, revision integer, status text, account_id integer, owner_id integer,
        account_type text, direction integer, currency text, property_id integer,
        category_id integer, identity_kind text, source_journal_id integer
      );
      CREATE TEMP TABLE categorization_payee_aliases (
        memory_id uuid, identity_kind text, normalized_alias text, active boolean
      );
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP TABLE property_valuations (property_id integer, valuation_date text);
      CREATE TEMP TABLE tenancies (property_id integer, start_date text, end_date text);
      CREATE TEMP TABLE property_ownership (property_id integer, owner_id integer);
    `);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((statement: SQL) => {
      const { sql, params } = dialect.sqlToQuery(statement);
      const result = queued.then(() => client.query(sql, params));
      queued = result.then(() => undefined, () => undefined);
      return result;
    });
  });
  afterAll(async () => { await queued; await client?.end(); });
  beforeEach(async () => {
    await queued;
    mocks.execute.mockClear();
    await client.query(`
      TRUNCATE accounts, journal_entries, book_entries, transaction_metadata,
        transaction_categorizations, categorization_learning, categorization_payee_aliases, categorization_payee_memories,
        properties, property_valuations, tenancies, property_ownership RESTART IDENTITY;
      INSERT INTO accounts VALUES (1,'Example bank','ASSET',NULL), (2,'Expenses','EXPENSE',NULL),
        (3,'Income','INCOME',NULL), (4,'Investment adjustments','EQUITY',NULL);
      INSERT INTO journal_entries(id,date,description) VALUES
        (1,'2026-07-10','Recorded July expense'),(2,'2026-08-10','Recorded August expense'),
        (3,'2026-09-10','Opening balance'),(4,'2026-09-15','Zero posting'),
        (5,'2026-10-10','Current expense'),(6,'2026-10-11','After report date');
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES
        (1,1,-10),(1,2,10),(2,1,-20),(2,2,20),(3,1,100),(3,4,-100),
        (4,1,0),(4,2,0),(5,1,-30),(5,2,30),(6,1,-40),(6,2,40);
    `);
  });

  it('distinguishes actual household journal coverage from eligible category backlog and excludes future postings', async () => {
    const result = await loadLedgerCoverage('2026-10-10');
    expect(result).toMatchObject({
      totalCount: 5, uncategorisedCount: 5, latestDate: '2026-10-10',
      recentMonths: ['2026-07', '2026-08'], transferReviewCount: 0, reviewNeededCount: 0,
    });
    // Opening equity has no spending classification. The zero posting still
    // remains eligible for a cautious review, while no September spending is
    // manufactured from it and October 11 is excluded by the report date.
    expect(result.eligibleCount).toBe(4);
    expect(result.unprocessedCount).toBe(4);
  });

  it('does not manufacture completed-month activity from transfers or equity adjustments', async () => {
    await client.query(`
      INSERT INTO journal_entries(id,date,description,is_transfer) VALUES (7,'2026-09-20','Confirmed transfer',true);
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES (7,1,-100),(7,2,100);
    `);
    expect((await loadLedgerCoverage('2026-10-10')).recentMonths).toEqual(['2026-07', '2026-08']);
    await client.query(`
      INSERT INTO journal_entries(id,date,description) VALUES (8,'2026-09-21','Recorded salary');
      INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES (8,1,1000),(8,3,-1000);
    `);
    expect((await loadLedgerCoverage('2026-10-10')).recentMonths).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('counts pending transfer groups once and excludes confirmed, dismissed, orphan and future groups', async () => {
    await client.query(`
      INSERT INTO journal_entries(id,date,description,is_transfer,transfer_group_id,transfer_review_dismissed_at) VALUES
        (10,'2026-10-09','First leg',false,'00000000-0000-0000-0000-000000000010',NULL),
        (11,'2026-10-09','Second leg',false,'00000000-0000-0000-0000-000000000010',NULL),
        (12,'2026-10-09','Dismissed first',false,'00000000-0000-0000-0000-000000000012',now()),
        (13,'2026-10-09','Dismissed second',false,'00000000-0000-0000-0000-000000000012',now()),
        (14,'2026-10-09','Merged first',true,'00000000-0000-0000-0000-000000000014',NULL),
        (15,'2026-10-09','Merged second',true,'00000000-0000-0000-0000-000000000014',NULL),
        (16,'2026-10-09','Orphan leg',false,'00000000-0000-0000-0000-000000000016',NULL),
        (17,'2026-10-11','Future first',false,'00000000-0000-0000-0000-000000000017',NULL),
        (18,'2026-10-11','Future second',false,'00000000-0000-0000-0000-000000000017',NULL);
      INSERT INTO book_entries(journal_entry_id,account_id,amount) SELECT id,1,-10 FROM journal_entries WHERE id>=10;
      INSERT INTO book_entries(journal_entry_id,account_id,amount) SELECT id,2,10 FROM journal_entries WHERE id>=10;
    `);
    expect((await loadLedgerCoverage('2026-10-10')).transferReviewCount).toBe(1);
  });

  it('preserves unknown category source counts if the decision table is unavailable', async () => {
    await client.query('ALTER TABLE transaction_categorizations RENAME TO hidden_categorizations');
    try {
      // TEMP shadowing must continue after the rename; a deliberately invalid
      // table blocks the decision read rather than falling back to public.
      await client.query('CREATE TEMP TABLE transaction_categorizations (unrelated text)');
      const result = await loadLedgerCoverage('2026-10-10');
      expect(result.totalCount).toBe(5);
      expect(result.reviewNeededCount).toBeNull();
      expect(result.eligibleCount).toBeNull();
      expect(result.unprocessedCount).toBeNull();
    } finally {
      await client.query('DROP TABLE transaction_categorizations');
      await client.query('ALTER TABLE hidden_categorizations RENAME TO transaction_categorizations');
    }
  });

  it('returns an actually empty available ledger with zero counts and no dates', async () => {
    await client.query('TRUNCATE journal_entries, book_entries');
    expect(await loadLedgerCoverage('2026-10-10')).toMatchObject({ totalCount: 0, uncategorisedCount: 0, reviewNeededCount: 0, eligibleCount: 0, unprocessedCount: 0, latestDate: null, recentMonths: [] });
  });

  it('uses dated valuations, active tenancy boundaries and recorded ownership without inferring market value or rent', async () => {
    await client.query(`
      INSERT INTO properties VALUES (1,'Example home'),(2,'Example rental');
      INSERT INTO property_valuations VALUES (1,'2026-09-01'),(1,'2026-10-11'),(2,'2026-10-12');
      INSERT INTO tenancies VALUES (1,'2026-09-01','2026-10-09'),(2,'2026-10-10','2026-10-10'),
        (2,'2026-10-11',NULL),(2,'2026-01-01',NULL);
      INSERT INTO property_ownership VALUES (2,1),(2,2);
    `);
    expect(await loadPropertyCoverage('2026-10-10')).toEqual([
      { id: 1, name: 'Example home', valuationDate: '2026-09-01', activeTenancyCount: 0, ownershipCount: 0 },
      { id: 2, name: 'Example rental', valuationDate: null, activeTenancyCount: 2, ownershipCount: 2 },
    ]);
  });
});
