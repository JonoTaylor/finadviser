import Decimal from 'decimal.js';
import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getOwner: vi.fn(), listProperties: vi.fn(), calculateEquity: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }), schema: { budgets: {} } }));
vi.mock('@/lib/repos', () => ({ propertyRepo: { getOwner: mocks.getOwner, listProperties: mocks.listProperties } }));
vi.mock('@/lib/properties/equity-calculator', () => ({ calculateEquity: mocks.calculateEquity }));
import { budgetRepo } from './budget.repo';
import { journalRepo } from './journal.repo';
import { calculatePersonalNetWorth } from '@/lib/properties/personal-net-worth';

// Runs the production queries against only TEMP tables; never migrates or
// modifies existing data. Uses the repository's existing optional PG harness.
const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('financial balances inside PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE categories (id integer PRIMARY KEY, name text, parent_id integer);
      CREATE TEMP TABLE budgets (id integer PRIMARY KEY, category_id integer, monthly_limit text, effective_from text);
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text, account_type text, owner_id integer, is_investment boolean DEFAULT false, investment_kind text);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, category_id integer, date text, is_transfer boolean, property_id integer);
      CREATE TEMP TABLE book_entries (journal_entry_id integer, account_id integer, amount text);
      CREATE TEMP TABLE mortgages (liability_account_id integer, property_id integer);
      CREATE TEMP VIEW v_account_balances AS
        SELECT a.id AS account_id, COALESCE(SUM(be.amount::numeric), 0) AS balance
        FROM accounts a LEFT JOIN book_entries be ON be.account_id = a.id GROUP BY a.id;
    `);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((statement: SQL) => {
      const { sql, params } = dialect.sqlToQuery(statement);
      return client.query(sql, params);
    });
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query('TRUNCATE categories, budgets, accounts, journal_entries, book_entries, mortgages');
    mocks.getOwner.mockResolvedValue({ id: 1, name: 'Owner' });
    mocks.listProperties.mockResolvedValue([]);
  });

  it('counts only expense legs, nets refunds, excludes transfers and wrong dates, and retains unused budgets', async () => {
    await client.query(`
      INSERT INTO categories (id, name) VALUES (1, 'Food'), (2, 'Unused'), (3, 'Future');
      INSERT INTO budgets VALUES (1, 1, '500', '2024-01-01'), (2, 2, '100', '2024-01-01'), (3, 3, '100', '2024-03-01');
      INSERT INTO accounts (id, name, account_type) VALUES (1, 'Bank', 'ASSET'), (2, 'Food', 'EXPENSE'), (3, 'Salary', 'INCOME');
      INSERT INTO journal_entries (id, category_id, date, is_transfer) VALUES
        (1, 1, '2024-02-01', false), (2, 1, '2024-02-29', false), (3, 1, '2024-02-10', true),
        (4, 1, '2024-03-01', false), (5, 1, '2023-02-01', false), (6, 1, '2024-01-31', false),
        (7, 1, '2024-02-15', false);
      INSERT INTO book_entries VALUES
        (1, 1, '-200'), (1, 2, '200'), (2, 1, '50'), (2, 2, '-50'),
        (3, 1, '-900'), (3, 2, '900'), (4, 1, '-900'), (4, 2, '900'),
        (5, 1, '-900'), (5, 2, '900'), (6, 1, '-900'), (6, 2, '900'),
        (7, 1, '3000'), (7, 3, '-3000');
    `);
    const rows = await budgetRepo.getStatusForMonth('2024-02');
    expect(rows.map(row => [row.category_name, row.spent])).toEqual([['Food', '150'], ['Unused', '0']]);
  });

  it('preserves a net refund and uses the next January as the December upper bound', async () => {
    await client.query(`
      INSERT INTO categories (id, name) VALUES (1, 'Food');
      INSERT INTO budgets VALUES (1, 1, '500', '2024-01-01');
      INSERT INTO accounts (id, name, account_type) VALUES (1, 'Bank', 'ASSET'), (2, 'Food', 'EXPENSE');
      INSERT INTO journal_entries (id, category_id, date, is_transfer) VALUES (1, 1, '2024-12-31', false), (2, 1, '2025-01-01', false);
      INSERT INTO book_entries VALUES (1, 1, '50'), (1, 2, '-50'), (2, 1, '-900'), (2, 2, '900');
    `);
    expect((await budgetRepo.getStatusForMonth('2024-12'))[0].spent).toBe('-50');
  });

  it('rolls parent budgets through all descendants by ID, excludes property costs, and terminates category cycles', async () => {
    await client.query(`
      INSERT INTO categories VALUES
        (1, 'Food', NULL), (2, 'Groceries', 1), (3, 'Market', 2),
        (4, 'Groceries', NULL), (5, 'Cycle A', 6), (6, 'Cycle B', 5);
      INSERT INTO budgets VALUES (1, 1, '500', '2024-01-01'), (2, 5, '100', '2024-01-01');
      INSERT INTO accounts (id, name, account_type) VALUES (1, 'Bank', 'ASSET'), (2, 'Food', 'EXPENSE');
      INSERT INTO journal_entries VALUES
        (1, 1, '2024-02-01', false, NULL), (2, 2, '2024-02-02', false, NULL),
        (3, 3, '2024-02-03', false, NULL), (4, 4, '2024-02-04', false, NULL),
        (5, 2, '2024-02-05', false, 10), (6, 5, '2024-02-06', false, NULL),
        (7, 6, '2024-02-07', false, NULL);
      INSERT INTO book_entries VALUES
        (1, 1, '-50'), (1, 2, '50'), (2, 1, '-100'), (2, 2, '100'),
        (3, 1, '-75'), (3, 2, '75'), (4, 1, '-900'), (4, 2, '900'),
        (5, 1, '-500'), (5, 2, '500'), (6, 1, '-10'), (6, 2, '10'),
        (7, 1, '-15'), (7, 2, '15');
    `);
    const rows = await budgetRepo.getStatusForMonth('2024-02');
    expect(rows.map(row => [row.category_name, row.spent])).toEqual([['Cycle A', '25'], ['Food', '225']]);
  });

  it('excludes mortgage debt already included in property equity and distinguishes personal debt from shared debt', async () => {
    mocks.listProperties.mockResolvedValue([{ id: 1, name: 'Home' }]);
    mocks.calculateEquity.mockResolvedValue([{ ownerId: 1, equityPct: 100, equityAmount: new Decimal('100000') }]);
    await client.query(`
      INSERT INTO accounts (id, name, account_type, owner_id, is_investment, investment_kind) VALUES
        (1, 'Cash', 'ASSET', 1, false, null), (2, 'Pension', 'ASSET', 1, true, 'pension'),
        (3, 'Card', 'LIABILITY', 1, false, null), (4, 'Mortgage', 'LIABILITY', 1, false, null),
        (5, 'Shared loan', 'LIABILITY', null, false, null), (6, 'Other person', 'ASSET', 2, false, null);
      INSERT INTO mortgages VALUES (4, 1);
      INSERT INTO book_entries VALUES (1, 1, '3000'), (1, 2, '20000'), (1, 3, '-4000'),
        (1, 4, '-150000'), (1, 5, '-5000'), (1, 6, '1000000');
    `);
    const result = await calculatePersonalNetWorth(1);
    expect(result).toMatchObject({ personalLiabilities: '4000.00', sharedLiabilitiesUnattributed: '5000.00', total: '119000.00' });
    expect(result?.perLiability.map(account => account.name)).toEqual(['Card']);
  });

  it('retains owner mortgage debt if no ownership slice was available to net it into property equity', async () => {
    await client.query(`
      INSERT INTO accounts (id, name, account_type, owner_id) VALUES (1, 'Unallocated mortgage', 'LIABILITY', 1);
      INSERT INTO mortgages VALUES (1, 10);
      INSERT INTO book_entries VALUES (1, 1, '-150000');
    `);
    const result = await calculatePersonalNetWorth(1);
    expect(result).toMatchObject({ propertyEquity: '0.00', personalLiabilities: '150000.00', total: '-150000.00' });
    expect(result?.perLiability.map(account => account.name)).toEqual(['Unallocated mortgage']);
  });

  it('monthly summaries and budget actual spending exclude same-month future entries and all future months', async () => {
    await client.query(`
      INSERT INTO categories (id, name) VALUES (1, 'Food'), (2, 'Salary');
      INSERT INTO budgets VALUES (1, 1, '500', '2026-01-01');
      INSERT INTO accounts (id, name, account_type) VALUES (1, 'Bank', 'ASSET'), (2, 'Food', 'EXPENSE'), (3, 'Salary', 'INCOME');
      INSERT INTO journal_entries (id, category_id, date, is_transfer) VALUES
        (1, 1, '2026-10-11', false), (2, 1, '2026-10-12', false), (3, 1, '2026-11-01', false),
        (4, 2, '2026-10-11', false), (5, 2, '2026-10-12', false),
        (6, 1, '2026-10-10', false), (7, 1, '2026-10-10', true);
      INSERT INTO book_entries VALUES
        (1, 1, '-100'), (1, 2, '100'), (2, 1, '-500'), (2, 2, '500'),
        (3, 1, '-900'), (3, 2, '900'), (4, 1, '3000'), (4, 3, '-3000'),
        (5, 1, '10000'), (5, 3, '-10000'), (6, 1, '25'), (6, 2, '-25'),
        (7, 1, '-500'), (7, 2, '500');
    `);
    const monthly = await journalRepo.getMonthlySpending('2026-10-11');
    expect(monthly.map(row => [row.month, row.account_type, row.total]).sort()).toEqual([
      ['2026-10', 'EXPENSE', '75'], ['2026-10', 'INCOME', '-3000'],
    ]);
    expect((await budgetRepo.getStatusForMonth('2026-10', '2026-10-11'))[0].spent).toBe('75');
    expect((await budgetRepo.getStatusForMonth('2026-11', '2026-10-11'))[0].spent).toBe('0');
  });
});
