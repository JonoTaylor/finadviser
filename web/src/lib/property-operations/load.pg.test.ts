import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const list = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listProperties: (...args: unknown[]) => list(...args) } }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: async () => ({ version: 1, revision: 0, updatedAt: null, data: { obligations: [], reserveTargets: [] } }) }));
import { loadPropertyOperationsWorkspace } from './load';

// This opt-in suite creates TEMP objects on its own connection. It neither
// migrates the application database nor reads or writes personal finance data.
const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('property operations SQL in disposable PostgreSQL', () => {
  let client: Client;
  let queuedQueries: Promise<unknown> = Promise.resolve();
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text);
      CREATE TEMP TABLE tenancies (id integer, property_id integer, tenant_name text, start_date text, end_date text, rent_amount numeric, rent_frequency text);
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, account_type text);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, property_id integer, date text, is_transfer boolean);
      CREATE TEMP TABLE book_entries (id integer GENERATED ALWAYS AS IDENTITY, journal_entry_id integer, account_id integer, amount numeric);
      CREATE TEMP TABLE mortgages (id integer, property_id integer, liability_account_id integer, start_date text);
      CREATE TEMP TABLE property_valuations (id integer, property_id integer, valuation numeric, valuation_date text);
      CREATE TEMP VIEW v_account_balances AS SELECT a.id AS account_id, COALESCE(SUM(be.amount), 0) AS balance FROM accounts a LEFT JOIN book_entries be ON be.account_id = a.id GROUP BY a.id;
    `);
    const dialect = new PgDialect();
    const runQuery = (text: string, params: unknown[] = []) => {
      const result = queuedQueries.then(() => client.query(text, params));
      queuedQueries = result.then(() => undefined, () => undefined);
      return result;
    };
    execute.mockImplementation(query => {
      const compiled = dialect.sqlToQuery(query);
      return runQuery(compiled.sql, compiled.params);
    });
    list.mockImplementation(async () => (await runQuery('SELECT id, name FROM properties ORDER BY name')).rows);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE properties, tenancies, accounts, journal_entries, book_entries, mortgages, property_valuations;
      INSERT INTO properties VALUES (1, 'Flat'), (2, 'House');
      INSERT INTO accounts VALUES (1, 'INCOME'), (2, 'ASSET'), (3, 'LIABILITY'), (4, 'EXPENSE');
      INSERT INTO tenancies VALUES
        (1, 1, 'Outgoing', '2026-01-15', '2026-09-15', 1000, 'monthly'),
        (2, 1, 'Incoming', '2026-09-15', NULL, 1100, 'monthly');
      INSERT INTO journal_entries VALUES
        (1, 1, '2026-09-15', false), (2, 1, '2026-09-17', false),
        (3, 1, '2026-09-20', true), (4, 1, '2026-10-15', false),
        (5, 1, '2026-01-01', false), (6, 1, '2026-11-01', false),
        (7, 1, '2026-09-21', false);
      INSERT INTO book_entries(journal_entry_id, account_id, amount) VALUES
        (1, 1, -1100), (1, 2, 1100),
        (2, 1, 100), (2, 2, -100),
        (3, 1, -500), (3, 2, 500),
        (4, 1, -2000), (4, 2, 2000),
        (5, 3, -120000), (5, 2, 120000),
        (6, 3, 50000), (6, 2, -50000),
        (7, 4, 250), (7, 2, -250);
      INSERT INTO mortgages VALUES (1, 1, 3, '2026-01-01'), (2, 1, 3, '2026-01-01');
      INSERT INTO property_valuations VALUES (1, 1, 200000, '2026-09-01'), (2, 1, 500000, '2026-11-01');
    `);
  });
  it('compares one handover due with signed income receipts, omitting transfer legs and future income', async () => {
    const workspace = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    const flat = workspace.summary.properties.find(row => row.id === 1)!;
    expect(flat).toMatchObject({ scheduledRent: '1100.00', recordedIncome: '1000.00', unreconciledRentGap: '100.00', incomeEntryCount: 2, coverage: { journalCount: 3, firstDate: '2026-09-15', lastDate: '2026-09-21', completeness: 'unverified' } });
    expect(workspace.summary.upcoming.lines.map(row => [row.tenancyId, row.dueDate])).toEqual([[2, '2026-10-15']]);
  });
  it('deduplicates mortgage products and excludes future balances and valuations from current LTV', async () => {
    const workspace = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    expect(workspace.summary.properties.find(row => row.id === 1)).toMatchObject({ valuation: '200000', mortgageDebt: '120000', loanToValuePercent: '60.0', valuationDate: '2026-09-01' });
  });
  it('leaves missing coverage unknown and does not invent another property mortgage', async () => {
    const workspace = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    expect(workspace.summary.properties.find(row => row.id === 2)).toMatchObject({ recordedIncome: null, unreconciledRentGap: null, mortgageDebt: '0', valuation: null, loanToValuePercent: null });
  });
  it('leaves debt unallocated when one mortgage account is shared across properties', async () => {
    await client.query("INSERT INTO mortgages VALUES (3, 2, 3, '2026-01-01')");
    const workspace = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    expect(workspace.summary.properties.every(row => row.mortgageDebt === null && row.loanToValuePercent === null)).toBe(true);
  });
  it('does not show a registered mortgage without dated ledger entries as paid off', async () => {
    await client.query("INSERT INTO accounts VALUES (5, 'LIABILITY'); INSERT INTO mortgages VALUES (3, 2, 5, '2026-01-01'); INSERT INTO property_valuations VALUES (3, 2, 300000, '2026-09-01')");
    const workspace = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    expect(workspace.summary.properties.find(row => row.id === 2)).toMatchObject({ mortgageDebt: null, loanToValuePercent: null });
  });
});
