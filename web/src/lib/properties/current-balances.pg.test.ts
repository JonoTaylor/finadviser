import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db', async () => ({
  getDb: () => mocks.db,
  schema: await import('@/lib/db/schema'),
}));
import { GET as getInvestments } from '@/app/api/investments/route';
import { accountRepo } from '@/lib/repos/account.repo';
import { propertyRepo } from '@/lib/repos/property.repo';
import { calculatePersonalNetWorth } from './personal-net-worth';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('current investment and owner balances inside PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    mocks.db = drizzle(client);
    await client.query(`
      CREATE TEMP TABLE owners (id integer PRIMARY KEY, name text, created_at timestamp DEFAULT NOW());
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text, account_type text, owner_id integer, is_investment boolean DEFAULT false, investment_kind text);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, date text);
      CREATE TEMP TABLE book_entries (journal_entry_id integer, account_id integer, amount numeric(14,2));
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text, address text, purchase_date text, purchase_price numeric(14,2), letting_type text DEFAULT 'standard', created_at timestamp DEFAULT NOW());
      CREATE TEMP TABLE property_ownership (id integer PRIMARY KEY, property_id integer, owner_id integer, capital_account_id integer, created_at timestamp DEFAULT NOW());
      CREATE TEMP TABLE mortgages (id integer PRIMARY KEY, property_id integer, lender text, original_amount numeric(14,2), start_date text, term_months integer, interest_only boolean DEFAULT false, liability_account_id integer, created_at timestamp DEFAULT NOW());
      CREATE TEMP TABLE property_valuations (id integer PRIMARY KEY, property_id integer, valuation numeric(14,2), valuation_date text, source text DEFAULT 'manual', created_at timestamp DEFAULT NOW());
      CREATE TEMP VIEW v_account_balances AS
        SELECT a.id AS account_id, COALESCE(SUM(be.amount), 0) AS balance
        FROM accounts a LEFT JOIN book_entries be ON be.account_id = a.id GROUP BY a.id;
    `);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE owners, accounts, journal_entries, book_entries, properties, property_ownership, mortgages, property_valuations;
      INSERT INTO owners(id, name) VALUES (1, 'Owner One'), (2, 'Owner Two');
      INSERT INTO accounts VALUES
        (1, 'Work pension', 'ASSET', 1, true, 'pension'),
        (2, 'ISA', 'ASSET', 2, true, 'isa'), (3, 'Future pension', 'ASSET', 1, true, 'pension'),
        (4, 'Bank', 'ASSET', 1, false, NULL), (5, 'Credit card', 'LIABILITY', 1, false, NULL),
        (6, 'Mortgage', 'LIABILITY', 1, false, NULL), (7, 'Capital One', 'EQUITY', 1, false, NULL),
        (8, 'Capital Two', 'EQUITY', 2, false, NULL);
      INSERT INTO journal_entries VALUES (1, '2026-09-01'), (2, '2026-10-01'), (3, '2026-10-02'), (4, '2026-10-03');
      INSERT INTO book_entries VALUES
        (1, 1, 10000), (2, 1, 500), (3, 1, 20000), (4, 1, -2500),
        (1, 2, 2000), (3, 3, 50000), (1, 4, 3000), (3, 4, -1500),
        (1, 5, -1000), (3, 5, -1000), (1, 6, -100000), (3, 6, 10000),
        (1, 7, 1000), (1, 8, 1000), (3, 7, 1000);
      INSERT INTO properties(id, name) VALUES (1, 'Home');
      INSERT INTO property_ownership(id, property_id, owner_id, capital_account_id) VALUES (1, 1, 1, 7), (2, 1, 2, 8);
      INSERT INTO mortgages(id, property_id, lender, original_amount, start_date, term_months, liability_account_id) VALUES (1, 1, 'Lender', 100000, '2026-09-01', 300, 6);
      INSERT INTO property_valuations(id, property_id, valuation, valuation_date) VALUES (1, 1, 300000, '2026-09-01'), (2, 1, 500000, '2026-10-02');
    `);
    // UTC is September; the UK calendar already reads 1 October.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('investment GET includes today, excludes future debits and credits, and supplies balanceAsOf', async () => {
    const response = await getInvestments();
    expect(response.status).toBe(200);
    const rows = await response.json();
    expect(rows.find((row: { id: number }) => row.id === 1)).toMatchObject({ balance: '10500.00', balanceAsOf: '2026-10-01', ownerId: 1 });
    expect(rows.find((row: { id: number }) => row.id === 2)).toMatchObject({ balance: '2000.00', ownerId: 2 });
    expect(rows.find((row: { id: number }) => row.id === 3)).toMatchObject({ balance: '0.00', balanceAsOf: '2026-10-01' });
  });

  it('personal net worth uses matching current valuations, mortgage debt, ownership capital, cash, investment and credit-card balances', async () => {
    const result = await calculatePersonalNetWorth(1);
    expect(result).toMatchObject({
      balanceAsOf: '2026-10-01', propertyEquity: '100000.00', investments: '10500.00',
      personalCash: '3000.00', personalLiabilities: '1000.00', total: '112500.00',
    });
    expect(result?.perProperty).toEqual([{ propertyId: 1, propertyName: 'Home', equityPct: 50, equityAmount: '100000.00' }]);
    expect(result?.perLiability.map(account => account.name)).toEqual(['Credit card']);
  });

  it('preserves legacy lifetime reads while explicit dated reads exclude future postings and valuations', async () => {
    expect(await accountRepo.getBalance(1)).toBe('28000.00');
    expect(await accountRepo.getBalance(1, '2026-10-01')).toBe('10500.00');
    expect(await accountRepo.getBalance(5, '2026-10-01')).toBe('-1000.00');
    expect(await accountRepo.getBalance(999, '2026-10-01')).toBe('0');
    expect((await propertyRepo.getLatestValuation(1))?.valuation).toBe('500000.00');
    expect((await propertyRepo.getLatestValuation(1, '2026-10-01'))?.valuation).toBe('300000.00');
  });

  it('the account balance list used by dashboard and AI exposes current signed balances with its existing shape', async () => {
    const balances = await accountRepo.getBalances();
    expect(balances.find(account => account.account_id === 1)).toEqual({ account_id: 1, account_name: 'Work pension', account_type: 'ASSET', balance: '10500.00' });
    expect(balances.find(account => account.account_id === 5)?.balance).toBe('-1000.00');
    expect(balances.find(account => account.account_id === 6)?.balance).toBe('-100000.00');
    expect(balances.find(account => account.account_id === 3)?.balance).toBe('0.00');
  });
});
