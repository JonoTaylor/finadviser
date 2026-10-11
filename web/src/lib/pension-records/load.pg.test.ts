import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), owners: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ propertyRepo: { listOwners: mocks.owners } }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: mocks.read }));
import { loadPensionRecordsWorkspace } from './load';
import { summarizePensionRecords } from './summary';

const url = process.env.DATA_PLAN_TEST_PG_URL;

// All objects are connection-local TEMP fixtures. Actual financial tables,
// workspace records and migration state are never modified by this test.
describe.skipIf(!url)('pension inventory query in disposable PostgreSQL', () => {
  let client: Client;
  let queued: Promise<unknown> = Promise.resolve();
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE owners (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text NOT NULL, account_type text NOT NULL,
        is_investment boolean NOT NULL, investment_kind text, owner_id integer);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, date text NOT NULL);
      CREATE TEMP TABLE book_entries (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_entry_id integer NOT NULL, account_id integer NOT NULL, amount numeric(14,2) NOT NULL);
      CREATE TEMP VIEW v_account_balances AS
        SELECT a.id AS account_id, COALESCE(SUM(b.amount), 0) AS balance
        FROM accounts a LEFT JOIN book_entries b ON b.account_id = a.id GROUP BY a.id;
      INSERT INTO owners VALUES (1, 'Jono'), (2, 'Another owner');
      INSERT INTO accounts VALUES
        (1, 'Jono pension', 'ASSET', true, 'pension', 1),
        (2, 'Wrong liability', 'LIABILITY', true, 'pension', 1),
        (3, 'ISA', 'ASSET', true, 'isa', 1),
        (4, 'Not an investment', 'ASSET', false, 'pension', 1),
        (5, 'Other pension', 'ASSET', true, 'pension', 2),
        (6, 'Unassigned pension', 'ASSET', true, 'pension', NULL);
      INSERT INTO journal_entries VALUES (1, '2001-01-01'), (2, '2099-01-01');
      INSERT INTO book_entries(journal_entry_id, account_id, amount) VALUES
        (1, 1, 10000.15), (2, 1, 90000.00), (1, 5, 50000.00);
    `);
    const run = (text: string, params: unknown[] = []) => {
      const result = queued.then(() => client.query(text, params));
      queued = result.then(() => undefined, () => undefined);
      return result;
    };
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(query => {
      const { sql, params } = dialect.sqlToQuery(query);
      return run(sql, params);
    });
    mocks.owners.mockImplementation(async () => (await run('SELECT id, name FROM owners ORDER BY id')).rows);
  });
  beforeEach(() => { mocks.read.mockResolvedValue({ version: 1, revision: 0, updatedAt: null, data: [] }); });
  afterAll(async () => { await client?.end(); });

  it('excludes future entries and accounts that are not pension ASSET investments', async () => {
    const result = await loadPensionRecordsWorkspace();
    expect(result.pensionAccounts.map(account => account.id).sort()).toEqual([1, 5, 6]);
    expect(result.pensionAccounts.find(account => account.id === 1)?.balance).toBe('10000.15');
    expect(result.pensionAccounts.find(account => account.id === 6)).toMatchObject({ ownerId: null, ownerName: null, balance: '0' });
    expect(result.owners).toEqual([{ id: 1, name: 'Jono' }, { id: 2, name: 'Another owner' }]);
  });

  it('summarises ledger capital by its actual owner while keeping benefit income separate', async () => {
    const common = { provider: null, statementAsOf: null, notes: null };
    const contribution = { type: 'dc', potAmount: null, personalMonthlyContribution: null, employerMonthlyContribution: null, annualFeeRate: null };
    const records = [
      { ...common, ...contribution, id: '00000000-0000-4000-8000-000000000001', name: 'DC one', ownerId: 1, linkedAccountId: 1 },
      { ...common, ...contribution, id: '00000000-0000-4000-8000-000000000002', name: 'DC two', ownerId: 2, linkedAccountId: 5 },
      { ...common, ...contribution, id: '00000000-0000-4000-8000-000000000003', name: 'Unknown DC', ownerId: null, linkedAccountId: 6 },
      { ...common, id: '00000000-0000-4000-8000-000000000004', name: 'DB', ownerId: 1, type: 'db', promisedAnnualIncome: '6000.00', startAge: 62 },
    ];
    mocks.read.mockResolvedValue({ version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00Z', data: records });
    const result = await loadPensionRecordsWorkspace();
    const personal = summarizePensionRecords(result.workspace.data, result.pensionAccounts, 1);
    expect(personal.dc.pot.knownTotal).toBe('10000.15');
    expect(personal.db.annualIncome.knownTotal).toBe('6000.00');
    expect(personal.excludedForMissingOwnership).toBe(1);
    expect(result.summary.dc.pot.knownTotal).toBe('60000.15');
    expect(result.summary.dc.totalMonthlyContributions.knownTotal).toBeNull();
  });
});
