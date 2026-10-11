import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ propertyRepo: {}, accountRepo: {} }));
vi.mock('./equity-calculator', () => ({ calculateEquity: vi.fn() }));
import { setInvestmentBalance } from './personal-net-worth';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('dated investment balance updates inside PostgreSQL', () => {
  let client: Client;
  // The function uses a unique schema; all financial tables remain TEMP.
  const testSchema = `investment_balance_test_${randomBytes(8).toString('hex')}`;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`CREATE SCHEMA "${testSchema}"`);
    await client.query(`SET search_path TO "${testSchema}", pg_temp, public`);
    await client.query(`
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text, account_type text, is_investment boolean, is_system boolean);
      CREATE TEMP TABLE journal_entries (id serial PRIMARY KEY, date text NOT NULL, description text NOT NULL);
      CREATE TEMP TABLE book_entries (
        journal_entry_id integer NOT NULL REFERENCES journal_entries(id),
        account_id integer NOT NULL REFERENCES accounts(id), amount numeric(14,2) NOT NULL
      );
    `);
    // Execute the actual migration function, rather than maintaining a test
    // copy that could diverge from the deployed write primitive.
    const migration = readFileSync(new URL('../db/migration.sql', import.meta.url), 'utf8');
    const statement = migration.match(/CREATE OR REPLACE FUNCTION set_investment_balance\([\s\S]*?\$\$ LANGUAGE plpgsql;/)?.[0];
    if (!statement) throw new Error('Investment balance function missing from migration');
    await client.query(statement);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(query => {
      const { sql, params } = dialect.sqlToQuery(query);
      return client.query(sql, params);
    });
  });
  afterAll(async () => {
    if (client) {
      await client.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await client.end();
    }
  });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE book_entries, journal_entries, accounts RESTART IDENTITY;
      INSERT INTO accounts VALUES (1, 'Pension', 'ASSET', true, false), (2, 'Investment Adjustments', 'EQUITY', false, true);
      INSERT INTO journal_entries(date, description) VALUES
        ('2026-01-01', 'Opening valuation'), ('2026-10-20', 'Future valuation'), ('2026-10-05', 'Recorded loss');
      INSERT INTO book_entries VALUES (1, 1, 1000), (1, 2, -1000), (2, 1, 2000), (2, 2, -2000), (3, 1, -50), (3, 2, 50);
    `);
  });
  const balance = async (asOf: string) => (await client.query(`
    SELECT SUM(be.amount)::text AS balance FROM book_entries be
    JOIN journal_entries je ON je.id = be.journal_entry_id
    WHERE be.account_id = 1 AND je.date <= $1
  `, [asOf])).rows[0].balance;

  it('sets today’s balance from dated entries while preserving existing future adjustments', async () => {
    const result = await setInvestmentBalance({ accountId: 1, newBalance: '1100', asOfDate: '2026-10-11' });
    expect(result).toMatchObject({ previousBalance: '950.00', delta: '150.00' });
    expect(await balance('2026-10-11')).toBe('1100.00');
    expect(await balance('2026-10-20')).toBe('3100.00');
    const journal = await client.query('SELECT SUM(amount)::text AS total, COUNT(*)::int AS legs FROM book_entries WHERE journal_entry_id = $1', [result.journalId]);
    expect(journal.rows[0]).toEqual({ total: '0.00', legs: 2 });
  });

  it('backdated updates include the chosen day and exclude later recorded and future entries', async () => {
    const result = await setInvestmentBalance({ accountId: 1, newBalance: '900', asOfDate: '2026-10-01' });
    expect(result).toMatchObject({ previousBalance: '1000.00', delta: '-100.00' });
    expect(await balance('2026-10-01')).toBe('900.00');
    expect(await balance('2026-10-11')).toBe('850.00');
  });

  it('repeated updates to the same dated target produce no second adjustment', async () => {
    await setInvestmentBalance({ accountId: 1, newBalance: '1100', asOfDate: '2026-10-11' });
    const repeat = await setInvestmentBalance({ accountId: 1, newBalance: '1100', asOfDate: '2026-10-11' });
    expect(repeat).toMatchObject({ previousBalance: '1100.00', delta: '0.00' });
    expect(await balance('2026-10-11')).toBe('1100.00');
  });

  it('rolls back the journal and both entries if the adjustment leg cannot be recorded', async () => {
    const countBefore = (await client.query('SELECT COUNT(*)::int AS count FROM journal_entries')).rows[0].count;
    await expect(client.query('SELECT * FROM set_investment_balance(1, 2000, $1, $2, 999)', ['2026-10-11', 'Invalid contra account'])).rejects.toMatchObject({ code: '23503' });
    expect((await client.query('SELECT COUNT(*)::int AS count FROM journal_entries')).rows[0].count).toBe(countBefore);
    expect(await balance('2026-10-11')).toBe('950.00');
  });
});
