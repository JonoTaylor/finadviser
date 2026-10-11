import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.fn();
const getSetting = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/repos/app-settings.repo', () => ({ appSettingsRepo: { get: (...args: unknown[]) => getSetting(...args) } }));

import { InvalidPlanningDataError, loadPlanningInput, PLANNING_PROFILE_KEY } from './load';
import { buildFinancialPlan } from './engine';

// Run only against a disposable PostgreSQL instance. Every object is TEMP
// and shadows app tables within this test's own connection; no migration,
// permanent table or real financial data is modified.
const url = process.env.DATA_PLAN_TEST_PG_URL;
const asOf = new Date('2026-10-11T12:00:00Z');

describe.skipIf(!url)('planning loader SQL inside disposable PostgreSQL', () => {
  let client: Client;
  let queuedQueries: Promise<unknown> = Promise.resolve();

  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE accounts (
        id integer PRIMARY KEY, name text NOT NULL, account_type text NOT NULL,
        is_investment boolean NOT NULL DEFAULT false, investment_kind text,
        owner_id integer
      );
      CREATE TEMP TABLE categories (id integer PRIMARY KEY, name text NOT NULL, parent_id integer);
      CREATE TEMP TABLE journal_entries (
        id integer PRIMARY KEY, date text NOT NULL, description text NOT NULL,
        reference text, category_id integer, property_id integer,
        is_transfer boolean NOT NULL DEFAULT false
      );
      CREATE TEMP TABLE book_entries (
        id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        journal_entry_id integer NOT NULL, account_id integer NOT NULL,
        amount numeric(14,2) NOT NULL
      );
      CREATE TEMP TABLE transaction_metadata (journal_entry_id integer PRIMARY KEY, merchant_name text);
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP TABLE mortgages (id integer PRIMARY KEY, property_id integer NOT NULL, liability_account_id integer NOT NULL);
      CREATE TEMP TABLE property_valuations (id integer PRIMARY KEY, property_id integer NOT NULL, valuation numeric(14,2) NOT NULL, valuation_date text NOT NULL);
      CREATE TEMP TABLE budgets (id integer PRIMARY KEY, category_id integer NOT NULL, monthly_limit text NOT NULL, effective_from text NOT NULL);
      CREATE TEMP TABLE app_settings (key text PRIMARY KEY, value text NOT NULL);
      CREATE TEMP VIEW v_account_balances AS
        SELECT a.id AS account_id, a.name AS account_name, a.account_type,
               COALESCE(SUM(be.amount::numeric), 0) AS balance
        FROM accounts a LEFT JOIN book_entries be ON be.account_id = a.id
        GROUP BY a.id, a.name, a.account_type;
    `);
    const dialect = new PgDialect();
    const runQuery = (text: string, params: unknown[]) => {
      const result = queuedQueries.then(() => client.query(text, params));
      queuedQueries = result.then(() => undefined, () => undefined);
      return result;
    };
    execute.mockImplementation(query => {
      const { sql, params } = dialect.sqlToQuery(query);
      return runQuery(sql, params);
    });
    getSetting.mockImplementation(async key => (await runQuery('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value ?? null);
  });

  afterAll(async () => { await client?.end(); });

  beforeEach(async () => {
    await client.query(`
      TRUNCATE accounts, categories, journal_entries, book_entries, transaction_metadata,
               properties, mortgages, property_valuations, budgets, app_settings;
      INSERT INTO accounts(id, name, account_type, is_investment, investment_kind) VALUES
        (1, 'Monzo current', 'ASSET', false, NULL),
        (2, 'Employment income', 'INCOME', false, NULL),
        (3, 'Living expenses', 'EXPENSE', false, NULL),
        (4, 'Work pension', 'ASSET', true, 'pension'),
        (5, 'Opening and investment adjustments', 'EQUITY', false, NULL),
        (6, 'Mortgage - Flat', 'LIABILITY', false, NULL),
        (7, 'Property: Flat', 'ASSET', false, NULL),
        (8, 'Rental income', 'INCOME', false, NULL),
        (9, 'Mortgage Interest', 'EXPENSE', false, NULL),
        (10, 'Easy access savings', 'ASSET', true, 'savings'),
        (11, 'Fixed term savings', 'ASSET', true, 'savings');
      INSERT INTO categories(id, name, parent_id) VALUES
        (1, 'Living', NULL), (2, 'Groceries', 1), (3, 'Mortgage', 1),
        (4, 'Rent', NULL), (5, 'Work', NULL), (6, 'Groceries', 5);
      INSERT INTO properties VALUES (1, 'Flat');
      INSERT INTO mortgages VALUES (1, 1, 6), (2, 1, 6);
      INSERT INTO property_valuations VALUES
        (1, 1, 250000, '2026-09-01'), (2, 1, 300000, '2026-11-01');
      INSERT INTO budgets VALUES
        (1, 1, '1100', '2026-01-01'), (2, 2, '800', '2026-01-01'),
        (3, 6, '200', '2026-01-01'), (4, 4, '500', '2026-11-01');
      INSERT INTO journal_entries(id, date, description, reference, category_id, property_id, is_transfer) VALUES
        (1, '2026-01-01', 'Opening cash', NULL, NULL, NULL, false),
        (2, '2026-01-01', 'Pension valuation adjustment', NULL, NULL, NULL, false),
        (3, '2026-01-01', 'Property acquisition', NULL, NULL, 1, false),
        (4, '2026-01-01', 'Opening savings', NULL, NULL, NULL, false),
        (5, '2026-01-01', 'Opening restricted savings', NULL, NULL, NULL, false),
        (10, '2026-07-01', 'Salary', NULL, NULL, NULL, false),
        (11, '2026-08-01', 'Salary', NULL, NULL, NULL, false),
        (12, '2026-09-01', 'Salary', NULL, NULL, NULL, false),
        (20, '2026-07-02', 'Groceries', NULL, 2, NULL, false),
        (21, '2026-08-02', 'Groceries', NULL, 2, NULL, false),
        (22, '2026-09-02', 'Groceries', NULL, 2, NULL, false),
        (23, '2026-09-03', 'Groceries refund', NULL, 2, NULL, false),
        (24, '2026-08-03', 'Statement payment marked transfer', NULL, 2, NULL, true),
        (25, '2026-08-04', 'Pension contribution transfer', NULL, NULL, NULL, true),
        (30, '2026-07-05', 'Mortgage payment - Lender', 'mortgage_payment:1:2026-07-05:700', 3, 1, false),
        (31, '2026-08-05', 'Mortgage payment - Lender', 'mortgage_payment:1:2026-08-05:700', 3, 1, false),
        (32, '2026-09-05', 'Mortgage payment - Lender', 'mortgage_payment:1:2026-09-05:700', 3, 1, false),
        (40, '2026-07-06', 'Rental receipt', NULL, 4, 1, false),
        (41, '2026-08-06', 'Rental receipt', NULL, 4, 1, false),
        (42, '2026-09-06', 'Rental receipt', NULL, 4, 1, false),
        (50, '2026-11-01', 'Future salary', NULL, NULL, NULL, false),
        (51, '2026-11-02', 'Future groceries', NULL, 2, NULL, false),
        (52, '2026-11-05', 'Mortgage payment - Lender', 'mortgage_payment:1:2026-11-05:700', 3, 1, false);
      INSERT INTO book_entries(journal_entry_id, account_id, amount) VALUES
        (1, 1, 5000), (1, 5, -5000),
        (2, 4, 10000), (2, 5, -10000),
        (3, 7, 200000), (3, 6, -120000), (3, 5, -80000),
        (4, 10, 1000), (4, 5, -1000),
        (5, 11, 600), (5, 5, -600),
        (10, 1, 3000), (10, 2, -3000), (11, 1, 3000), (11, 2, -3000), (12, 1, 3000), (12, 2, -3000),
        (20, 1, -1000), (20, 3, 1000), (21, 1, -1000), (21, 3, 1000), (22, 1, -1000), (22, 3, 1000),
        (23, 1, 200), (23, 3, -200),
        (24, 1, 400), (24, 3, -400), (25, 1, -100), (25, 4, 100),
        (30, 1, -700), (30, 6, 200), (30, 9, 500),
        (31, 1, -700), (31, 6, 200), (31, 9, 500),
        (32, 1, -700), (32, 6, 200), (32, 9, 500),
        (40, 1, 900), (40, 8, -900), (41, 1, 900), (41, 8, -900), (42, 1, 900), (42, 8, -900),
        (50, 1, 10000), (50, 2, -10000), (51, 1, -20000), (51, 3, 20000),
        (52, 1, -700), (52, 6, 200), (52, 9, 500);
      INSERT INTO transaction_metadata VALUES (20, 'Grocer'), (21, 'Grocer'), (22, 'Grocer'), (23, 'Grocer');
    `);
    await client.query('INSERT INTO app_settings VALUES ($1, $2)', [PLANNING_PROFILE_KEY, JSON.stringify({ essentialMonthlySpending: 1500, riskTolerance: 'medium' })]);
  });

  it('reads real income, expenses, refunds and mortgage principal without transfers or opening/valuation adjustments', async () => {
    const loaded = await loadPlanningInput(asOf);
    expect(loaded.input.transactions).toHaveLength(16);
    expect(loaded.source.transactionCount).toBe(13);
    expect(loaded.input.transactions.find(transaction => transaction.id === '23:EXPENSE')).toMatchObject({ amount: 200, cashflowType: 'refund' });
    expect(loaded.input.transactions.find(transaction => transaction.id === '30:PRINCIPAL')).toMatchObject({ amount: -200, propertyId: 1, categoryId: null, categoryAncestorIds: [] });
    const excludedIds = ['1', '2', '3', '24', '25', '50', '51', '52'];
    expect(loaded.input.transactions.filter(transaction => excludedIds.includes(String(transaction.id).split(':')[0]))).toEqual([]);
    expect(loaded.input.profile).toMatchObject({ essentialMonthlySpending: 1500, riskTolerance: 'medium', statePensionAnnual: null });
    expect(loaded.profileSaved).toBe(true);
    const plan = buildFinancialPlan(loaded.input);
    expect(plan.cashflow).toMatchObject({ monthlyIncome: 3900, monthlySpending: 1633.33, monthlyPersonalSpending: 933.33, monthlyPropertySpending: 700, monthlySurplus: 2266.67 });
  });

  it('uses as-of balances/valuation, counts duplicate mortgage products once and replaces acquisition value once', async () => {
    const loaded = await loadPlanningInput(asOf);
    expect(loaded.input.accounts.find(account => account.id === 1)?.balance).toBe(12100);
    expect(loaded.input.accounts.filter(account => account.id === 6 || account.id === 7)).toEqual([]);
    expect(loaded.input.properties).toEqual([{ id: 1, name: 'Flat', value: 250000, debt: 119400, monthlyRent: 900, monthlyCosts: 700 }]);
    const plan = buildFinancialPlan(loaded.input);
    expect(plan.balanceSheet).toMatchObject({ knownAssets: 273800, propertyValue: 250000, propertyDebt: 119400, propertyEquity: 130600, netWorth: 154400, cash: 13100, pensions: 10100 });
    expect(plan.emergencyFund).toMatchObject({ cashAvailable: 13100, cashAccessibility: 'inferred', isEstimate: true });
    expect(plan.emergencyFund.basis).toContain('not confirmed withdrawal access');
    expect(loaded.source.warnings.join(' ')).toContain('Cash accessibility is inferred');
    expect(loaded.input.accounts.find(account => account.id === 11)?.isLiquidCash).toBe(false);
  });

  it('preserves duplicate category names, ancestor IDs and personal parent-budget rollup while excluding property spending', async () => {
    const loaded = await loadPlanningInput(asOf);
    expect(loaded.input.transactions.find(transaction => transaction.id === '20:EXPENSE')?.categoryAncestorIds).toEqual(expect.arrayContaining([1, 2]));
    expect(loaded.input.budgets.map(budget => budget.categoryId).sort()).toEqual([1, 2, 6]);
    const plan = buildFinancialPlan(loaded.input);
    expect(plan.budgets.find(budget => budget.categoryId === 1)).toMatchObject({ observedMonthlySpending: 933.33, status: 'within-budget' });
    expect(plan.budgets.find(budget => budget.categoryId === 2)).toMatchObject({ observedMonthlySpending: 933.33, status: 'over-budget' });
    expect(plan.budgets.find(budget => budget.categoryId === 6)).toMatchObject({ observedMonthlySpending: null, status: 'unknown' });
  });

  it('terminates malformed category cycles without repeating ancestor IDs', async () => {
    await client.query('UPDATE categories SET parent_id = 2 WHERE id = 1');
    const loaded = await loadPlanningInput(asOf);
    const ancestors = loaded.input.transactions.find(transaction => transaction.id === '20:EXPENSE')?.categoryAncestorIds;
    expect(ancestors).toHaveLength(2);
    expect(new Set(ancestors).size).toBe(2);
  });

  it('rejects a mortgage liability reused across different properties rather than double-counting debt', async () => {
    await client.query("INSERT INTO properties VALUES (2, 'Other flat'); INSERT INTO mortgages VALUES (3, 2, 6)");
    await expect(loadPlanningInput(asOf)).rejects.toBeInstanceOf(InvalidPlanningDataError);
  });
});
