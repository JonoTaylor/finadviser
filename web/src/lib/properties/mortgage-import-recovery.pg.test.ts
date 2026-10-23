import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ db: null as unknown, write: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => state.db, schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos', () => ({
  propertyRepo: { getOwnership: async () => [{ owner_id: 2, capital_account_id: 9 }] },
  accountRepo: { getOrCreate: async () => ({ id: 3 }) }, journalRepo: { createEntriesBulk: state.write },
}));
import { parseMortgagePayments } from './mortgage-payment-parser';
import { recordMortgagePayments } from './mortgage-tracker';
import { correctMortgagePaymentDate, previewMortgagePaymentDateCorrection } from './mortgage-payment-date-review';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('complete statement recovery after the earlier parser', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, name text, account_type text);
      CREATE TEMP TABLE mortgages (id integer PRIMARY KEY, property_id integer, liability_account_id integer, lender text, interest_only boolean);
      CREATE TEMP TABLE journal_entries (id serial PRIMARY KEY, date text, description text, reference text, property_id integer, category_id integer, is_transfer boolean DEFAULT false);
      CREATE TEMP TABLE book_entries (id serial PRIMARY KEY, journal_entry_id integer, account_id integer, amount numeric(14,2));
      INSERT INTO accounts VALUES (2, 'Fixture payment account', 'ASSET'), (3, 'Mortgage Interest', 'EXPENSE');
      INSERT INTO mortgages VALUES (1, 20, 7, 'Fixture lender', true);
    `);
    state.db = drizzle(client);
    state.write.mockImplementation(async (items: { journal: { date: string; description: string; reference: string; propertyId: number }; entries: { accountId: number; amount: string }[] }[]) => {
      const ids = [];
      for (const item of items) {
        const result = await client.query('INSERT INTO journal_entries(date,description,reference,property_id) VALUES($1,$2,$3,$4) RETURNING id',
          [item.journal.date, item.journal.description, item.journal.reference, item.journal.propertyId]);
        const id = Number(result.rows[0].id);
        ids.push(id);
        for (const entry of item.entries) await client.query('INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES($1,$2,$3)', [id, entry.accountId, entry.amount]);
      }
      return ids;
    });
  });
  afterAll(async () => { await client?.end(); });

  it('books only the four missing rows, reviews five possible earlier dates, then replays as nine duplicates with unchanged money', async () => {
    const statement = [
      ['30/09/2026', '1861.22'], ['28/08/2026', '1861.22'], ['31/07/2026', '1382.36'],
      ['30/06/2026', '1382.36'], ['29/05/2026', '1382.36'], ['30/04/2026', '1382.36'],
      ['31/03/2026', '1382.36'], ['27/02/2026', '1382.36'], ['30/01/2026', '1382.36'],
    ].map(([date, amount]) => `${date} Receipt £${amount} Credit`).join('');
    const parsed = parseMortgagePayments(statement);
    expect(parsed.unparsed).toEqual([]);
    for (const payment of parsed.valid.filter(payment => !payment.date.endsWith('-30'))) {
      const wrongDate = payment.date.slice(0, 8) + '0' + payment.date.slice(-1);
      const inserted = await client.query("INSERT INTO journal_entries(date,description,reference,property_id) VALUES($1,'Fixture earlier import',$2,20) RETURNING id",
        [wrongDate, `mortgage_payment:1:${wrongDate}:${payment.amount}`]);
      const id = Number(inserted.rows[0].id);
      await client.query('INSERT INTO book_entries(journal_entry_id,account_id,amount) VALUES($1,2,-$2::numeric),($1,3,$2::numeric)', [id, payment.amount]);
    }
    const record = () => recordMortgagePayments({ mortgageId: 1, payerOwnerId: 2, fromAccountId: 2, payments: parsed.valid });
    const first = await record();
    expect(first.added).toHaveLength(4);
    expect(first.errors).toHaveLength(5);
    expect(first.errors.every(error => error.code === 'possible_legacy_date')).toBe(true);
    const postingsBefore = (await client.query('SELECT * FROM book_entries ORDER BY id')).rows;
    for (const candidate of first.errors) {
      const input = { mortgageId: 1, journalId: candidate.existingJournalId!, correctDate: candidate.date };
      const review = await previewMortgagePaymentDateCorrection(input);
      expect(review.canCorrect).toBe(true);
      const corrected = await correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot });
      expect(corrected.corrected).toBe(true);
      expect(corrected.record.date).toBe(candidate.date);
    }
    expect((await client.query('SELECT * FROM book_entries ORDER BY id')).rows).toEqual(postingsBefore);
    const retry = await record();
    expect(retry).toMatchObject({ added: [], errors: [] });
    expect(retry.duplicates).toHaveLength(9);
    expect((await client.query('SELECT count(*) AS count FROM journal_entries')).rows[0].count).toBe('9');
    expect((await client.query('SELECT SUM(amount) AS total FROM book_entries WHERE account_id=3')).rows[0].total).toBe('13398.96');
    expect((await client.query('SELECT SUM(amount) AS balance FROM book_entries')).rows[0].balance).toBe('0.00');
  });
});
