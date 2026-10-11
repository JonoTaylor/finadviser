import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => mocks.db }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: vi.fn() }));
import { loadPortfolioAccounts, validatePortfolioAgainstAccounts } from './load';
import { analyzePortfolio } from './analyze';
import type { PortfolioData } from './schema';
const url = process.env.DATA_PLAN_TEST_PG_URL;
// TEMP objects shadow real tables in this connection. Only disposable fixture
// data is written; the application ledger and settings are never modified.
describe.skipIf(!url)('portfolio adapter SQL in disposable PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    mocks.db = drizzle(client);
    await client.query(`
      CREATE TEMP TABLE owners (id integer PRIMARY KEY, name text);
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text, account_type text, is_investment boolean, investment_kind text, owner_id integer);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, date text);
      CREATE TEMP TABLE book_entries (journal_entry_id integer, account_id integer, amount numeric(14,2));
      CREATE TEMP VIEW v_account_balances AS SELECT a.id AS account_id, COALESCE(SUM(be.amount), 0) AS balance
      FROM accounts a LEFT JOIN book_entries be ON be.account_id = a.id GROUP BY a.id;
    `);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE owners, accounts, journal_entries, book_entries;
      INSERT INTO owners VALUES (1, 'Jono'), (2, 'Other owner');
      INSERT INTO accounts VALUES (1, 'ISA', 'ASSET', true, 'isa', 1), (2, 'Pension', 'ASSET', true, 'pension', 2),
        (3, 'Bank', 'ASSET', false, NULL, 1), (4, 'Incorrect investment liability', 'LIABILITY', true, 'other', 1),
        (5, 'Empty ISA', 'ASSET', true, 'isa', 1);
      INSERT INTO journal_entries VALUES (1, '2026-10-01'), (2, '2026-10-11'), (3, '2026-10-12'), (4, '2026-10-13');
      INSERT INTO book_entries VALUES (1, 1, 10000), (2, 1, 500), (3, 1, 50000), (4, 1, -2500),
        (1, 2, 20000), (3, 2, 10000), (1, 3, 5000), (1, 4, -5000);
    `);
  });
  it('includes the current calendar date and excludes future credits and debits with their signs', async () => {
    const accounts = await loadPortfolioAccounts('2026-10-11');
    expect(accounts.find(account => account.id === 1)).toMatchObject({ balance: '10500.00', balanceAsOf: '2026-10-11', ownerName: 'Jono' });
    expect(accounts.find(account => account.id === 2)).toMatchObject({ balance: '20000.00', ownerName: 'Other owner' });
    expect(accounts.find(account => account.id === 5)?.balance).toBe('0.00');
  });
  it('accepts holdings only for investment assets, rejecting flagged liabilities and ordinary bank accounts', async () => {
    const accounts = await loadPortfolioAccounts('2026-10-11');
    expect(accounts.map(account => account.id).sort()).toEqual([1, 2, 5]);
    for (const accountId of [3, 4, 999]) {
      const data: PortfolioData = { holdings: [{ id: 'fund', name: 'Fund', accountId, assetClass: 'equity', currency: 'GBP', value: '1', valuationDate: '2026-10-11', feeRate: null, provider: null }], platforms: [] };
      expect(validatePortfolioAgainstAccounts(data, accounts, '2026-10-11')).toContain('investment ASSET account');
    }
  });
  it('reconciles holding snapshots to current ledger balances without adding their value as assets', async () => {
    const accounts = await loadPortfolioAccounts('2026-10-11');
    const data: PortfolioData = { holdings: [{ id: 'fund', name: 'Fund', accountId: 1, assetClass: 'equity', currency: 'GBP', value: '11000', valuationDate: '2026-10-01', feeRate: '0.25', provider: null }], platforms: [{ accountId: 1, feeRate: '0.1' }] };
    const result = analyzePortfolio(data, accounts, '2026-10-11');
    expect(result.totalLedgerBalance).toBe('30500.00');
    expect(result.totalAllocated).toBe('11000.00');
    expect(result.totalOverallocated).toBe('500.00');
    expect(result.accounts.find(account => account.id === 1)?.annualPlatformCharge).toBe('10.50');
    expect(result.accounts.find(account => account.id === 1)?.datesMatchLedger).toBe(false);
    expect(validatePortfolioAgainstAccounts(data, accounts, '2026-10-11')).toContain('£500.00');
  });
});
