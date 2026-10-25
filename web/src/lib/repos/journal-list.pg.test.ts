import { Client } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { journalRepo } from './journal.repo';
import { loadUnlinkedPropertyExpenseCount } from '@/lib/data-intelligence/load';

// TEMP tables only, shadowing application tables in this connection.
const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('transaction list property links in PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE categories (id integer PRIMARY KEY, name text NOT NULL, parent_id integer);
      CREATE TEMP TABLE properties (id integer PRIMARY KEY, name text NOT NULL);
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text NOT NULL, account_type text NOT NULL);
      CREATE TEMP TABLE journal_entries (
        id integer PRIMARY KEY, date text NOT NULL, description text NOT NULL, reference text,
        category_id integer, property_id integer, is_transfer boolean DEFAULT false, transfer_kind text,
        transfer_group_id uuid, transfer_partner_journal_id integer
      );
      CREATE TEMP TABLE book_entries (id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY, journal_entry_id integer, account_id integer, amount numeric(14,2));
      CREATE TEMP TABLE transaction_metadata (journal_entry_id integer PRIMARY KEY, merchant_name text, merchant_emoji text,
        transaction_type text, bank_category text, notes text, address text);
    `);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((statement: SQL) => {
      const { sql, params } = dialect.sqlToQuery(statement);
      return client.query(sql, params);
    });
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    await client.query(`
      TRUNCATE categories, properties, accounts, journal_entries, book_entries, transaction_metadata RESTART IDENTITY;
      INSERT INTO categories VALUES (1,'Property expenses',NULL), (2,'Repairs & maintenance',1), (3,'Groceries',NULL);
      INSERT INTO properties VALUES (7,'Fixture Flat');
      INSERT INTO accounts VALUES (1,'Bank','ASSET'), (2,'Expenses','EXPENSE');
      INSERT INTO journal_entries(id,date,description,category_id,property_id,is_transfer) VALUES
        (1,'2026-10-01','Unlinked repair',2,NULL,false),
        (2,'2026-10-02','Linked repair',2,7,false),
        (3,'2026-10-03','Groceries',3,NULL,false),
        (4,'2026-10-04','Transfer with a property category',2,NULL,true);
      INSERT INTO book_entries(journal_entry_id,account_id,amount)
        SELECT id, 1, -50 FROM journal_entries UNION ALL SELECT id, 2, 50 FROM journal_entries;
    `);
  });

  it("returns each row's property link and name", async () => {
    const rows = await journalRepo.listEntries({}) as Array<{ id: number; property_id: number | null; property_name: string | null }>;
    expect(rows.find(row => row.id === 2)).toMatchObject({ property_id: 7, property_name: 'Fixture Flat' });
    expect(rows.find(row => row.id === 1)).toMatchObject({ property_id: null, property_name: null });
  });

  it("lists only unlinked property expenses, with a matching total and the Data assistant's count", async () => {
    const rows = await journalRepo.listEntries({ unlinkedPropertyExpenses: true }) as Array<{ id: number }>;
    expect(rows.map(row => row.id)).toEqual([1]);
    expect(await journalRepo.countEntries({ unlinkedPropertyExpenses: true })).toBe(1);
    expect(await loadUnlinkedPropertyExpenseCount('2026-10-10')).toBe(1);
  });
});
