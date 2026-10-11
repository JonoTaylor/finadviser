import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), owners: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listOwners: mocks.owners } }));
import { loadContextLookup } from './lookup';
import { defaultContext, resolveCashAccessibility } from './schema';

// Every fixture is a TEMP object on a disposable PostgreSQL connection.
// These tests do not change permanent tables or a real user's ledger.
const url = process.env.DATA_PLAN_TEST_PG_URL;

describe.skipIf(!url)('context evidence from real PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text NOT NULL, account_type text NOT NULL,
        is_investment boolean NOT NULL DEFAULT false, investment_kind text, owner_id integer);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, date text NOT NULL);
      CREATE TEMP TABLE book_entries (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_entry_id integer NOT NULL, account_id integer NOT NULL, amount numeric(14,2) NOT NULL);
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP TABLE owners (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP VIEW v_account_balances AS SELECT a.id AS account_id, COALESCE(SUM(b.amount), 0) AS balance
        FROM accounts a LEFT JOIN book_entries b ON b.account_id = a.id GROUP BY a.id;
    `);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(query => {
      const parsed = dialect.sqlToQuery(query);
      return client.query(parsed.sql, parsed.params);
    });
    mocks.owners.mockImplementation(async () => (await client.query('SELECT id, name FROM owners ORDER BY name')).rows);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE accounts, journal_entries, book_entries, properties, owners;
      INSERT INTO owners VALUES (12, 'Alex'), (42, 'Jono');
      INSERT INTO accounts VALUES
        (1, 'Current account', 'ASSET', false, NULL, 42),
        (2, 'Credit card', 'LIABILITY', false, NULL, 42),
        (3, 'Unposted savings', 'ASSET', true, 'savings', NULL),
        (4, 'Pension', 'ASSET', true, 'pension', 12),
        (5, 'Property: Flat', 'ASSET', false, NULL, NULL),
        (6, 'Equity adjustments', 'EQUITY', false, NULL, NULL);
      INSERT INTO properties VALUES (8, 'Flat');
      INSERT INTO journal_entries VALUES (1, '2026-10-10'), (2, '2026-11-01'), (3, '2026-12-01'), (4, '2026-10-01');
      INSERT INTO book_entries (journal_entry_id, account_id, amount) VALUES
        (1, 1, 1250.50), (2, 1, 900.00), (3, 1, -100.00),
        (4, 2, -600.00), (2, 2, -400.00), (4, 4, 65000.00), (4, 5, 250000.00);
    `);
  });

  it('uses signed postings up to the London date and excludes every future posting from balance and freshness', async () => {
    const result = await loadContextLookup(new Date('2026-10-11T12:00:00Z'));
    expect(result.accounts.find(account => account.id === 1)).toMatchObject({ balance: '1250.50', latestJournalDate: '2026-10-10', postingCount: 1, futurePostingCount: 2 });
    expect(result.accounts.find(account => account.id === 2)).toMatchObject({ balance: '-600.00', latestJournalDate: '2026-10-01', postingCount: 1, futurePostingCount: 1 });
  });

  it('keeps absent balance evidence distinguishable from a verified empty bank account', async () => {
    const result = await loadContextLookup(new Date('2026-10-11T12:00:00Z'));
    expect(result.accounts.find(account => account.id === 3)).toMatchObject({ balance: '0.00', latestJournalDate: null, postingCount: 0, ownerId: null });
    expect(result.accounts.some(account => account.id === 6)).toBe(false);
    expect(defaultContext.ownerId).toBeNull();
    expect(result.owners).toEqual([{ id: 12, name: 'Alex' }, { id: 42, name: 'Jono' }]);
  });

  it('preserves account owner and property/pension classification so overrides cannot inflate cash', async () => {
    const result = await loadContextLookup(new Date('2026-10-11T12:00:00Z'));
    const property = result.accounts.find(account => account.id === 5)!;
    const pension = result.accounts.find(account => account.id === 4)!;
    expect(property.isPropertyAsset).toBe(true);
    expect(pension.ownerId).toBe(12);
    expect(resolveCashAccessibility(property, { accountAccessibility: [{ accountId: 5, accessibility: 'available' }] }).eligible).toBe(false);
    expect(resolveCashAccessibility(pension, { accountAccessibility: [{ accountId: 4, accessibility: 'available' }] }).eligible).toBe(false);
  });
});
