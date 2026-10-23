import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown, write: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => state.db, schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos', () => ({
  propertyRepo: { getOwnership: async () => [{ owner_id: 1, capital_account_id: 9 }] },
  accountRepo: { getOrCreate: async (name: string) => ({ id: name === 'Mortgage Interest' ? 3 : 4 }) },
  journalRepo: { createEntriesBulk: state.write },
}));
import { recordMortgagePayments } from './mortgage-tracker';

type WriteItem = {
  journal: { date: string; description: string; reference?: string; propertyId: number };
  entries: { accountId: number; amount: string }[];
};
const url = process.env.DATA_PLAN_TEST_PG_URL;

// Real production lookup queries run against TEMP tables on an isolated PG
// connection. Journal writes are fixture-only, recording their actual postings.
describe.skipIf(!url)('mortgage retry protection in PostgreSQL', () => {
  let client: Client;
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE mortgages (id integer PRIMARY KEY, property_id integer, liability_account_id integer, lender text);
      CREATE TEMP TABLE journal_entries (id serial PRIMARY KEY, date text, description text, reference text, property_id integer);
      CREATE TEMP TABLE book_entries (journal_entry_id integer, account_id integer, amount numeric(14,2));
    `);
    state.db = drizzle(client);
    state.write.mockImplementation(async (items: WriteItem[]) => {
      const ids: number[] = [];
      for (const item of items) {
        const inserted = await client.query(`INSERT INTO journal_entries (date, description, reference, property_id)
          VALUES ($1, $2, $3, $4) RETURNING id`, [item.journal.date, item.journal.description, item.journal.reference ?? null, item.journal.propertyId]);
        const id = Number(inserted.rows[0].id);
        ids.push(id);
        for (const entry of item.entries) await client.query('INSERT INTO book_entries VALUES ($1, $2, $3)', [id, entry.accountId, entry.amount]);
      }
      return ids;
    });
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    state.write.mockClear();
    await client.query(`TRUNCATE mortgages, journal_entries, book_entries RESTART IDENTITY;
      INSERT INTO mortgages VALUES (1, 20, 7, 'Fixture lender'), (2, 20, 8, 'Other fixture lender');`);
  });

  const record = (payments: { date: string; amount: string; principal?: string }[]) => recordMortgagePayments({
    mortgageId: 1, payerOwnerId: 1, fromAccountId: 2, payments,
  });
  async function seed(date: string, amount: string, mortgageId = 1, propertyId = 20, referenceDate = date) {
    const result = await client.query(`INSERT INTO journal_entries (date, description, reference, property_id)
      VALUES ($1, 'Fixture existing payment', $2, $3) RETURNING id`, [date, `mortgage_payment:${mortgageId}:${referenceDate}:${amount}`, propertyId]);
    return Number(result.rows[0].id);
  }

  it('records the four formerly rejected dates exactly and makes a sequential retry a no-op', async () => {
    const payments = [
      { date: '2026-09-30', amount: '1861.22' }, { date: '2026-06-30', amount: '1382.36' },
      { date: '2026-04-30', amount: '1382.36' }, { date: '2026-01-30', amount: '1382.36' },
    ];
    expect(await record(payments)).toMatchObject({ added: payments.map(payment => expect.objectContaining(payment)), duplicates: [], errors: [] });
    const retry = await record(payments);
    expect(retry.added).toEqual([]);
    expect(retry.duplicates).toHaveLength(4);
    expect(state.write).toHaveBeenCalledTimes(1);
    expect((await client.query('SELECT count(*) AS count FROM journal_entries')).rows[0].count).toBe('4');
    expect((await client.query('SELECT SUM(amount) AS balance FROM book_entries')).rows[0].balance).toBe('0.00');
    expect((await client.query('SELECT SUM(amount) AS total FROM book_entries WHERE account_id = 3')).rows[0].total).toBe('6008.30');
  });

  it('blocks a candidate from the earlier day-splitting bug without altering the record', async () => {
    const id = await seed('2026-08-08', '1861.22');
    const result = await record([{ date: '2026-08-28', amount: '1861.22' }]);
    expect(result).toMatchObject({ added: [], duplicates: [], errors: [{
      date: '2026-08-28', amount: '1861.22', code: 'possible_legacy_date', existingJournalId: id, existingDate: '2026-08-08',
    }] });
    expect(state.write).not.toHaveBeenCalled();
    expect((await client.query('SELECT date FROM journal_entries WHERE id = $1', [id])).rows[0].date).toBe('2026-08-08');
  });

  it('checks each row separately so safe thirtieth-day payments proceed while earlier-date candidates wait for review', async () => {
    await seed('2026-07-01', '1382.36');
    const result = await record([{ date: '2026-07-31', amount: '1382.36' }, { date: '2026-06-30', amount: '1382.36' }]);
    expect(result.added).toEqual([expect.objectContaining({ date: '2026-06-30', amount: '1382.36' })]);
    expect(result.errors).toEqual([expect.objectContaining({ date: '2026-07-31', code: 'possible_legacy_date' })]);
  });

  it('prefers the exact correct duplicate when an earlier-date payment also exists', async () => {
    await seed('2026-08-08', '1861.22');
    const exact = await seed('2026-08-28', '1861.22');
    const result = await record([{ date: '2026-08-28', amount: '1861.22' }]);
    expect(result).toEqual({ added: [], errors: [], duplicates: [{ date: '2026-08-28', amount: '1861.22', existingJournalId: exact }] });
    expect(state.write).not.toHaveBeenCalled();
  });

  it('does not mistake another mortgage, month or amount for a candidate', async () => {
    await seed('2026-08-08', '1861.22', 2);
    await seed('2026-07-08', '1861.22');
    await seed('2026-08-08', '1000.00');
    const result = await record([{ date: '2026-08-28', amount: '1861.22' }]);
    expect(result.added).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('blocks inconsistent date or property evidence rather than calling it a safe duplicate', async () => {
    const id = await seed('2026-08-08', '1861.22', 1, 99, '2026-08-28');
    expect(await record([{ date: '2026-08-28', amount: '1861.22' }])).toMatchObject({
      added: [], duplicates: [], errors: [{ code: 'payment_record_mismatch', existingJournalId: id, existingDate: '2026-08-08' }],
    });
    expect(state.write).not.toHaveBeenCalled();
  });

  it('flags multiple existing journals for one reference rather than concealing them', async () => {
    await seed('2026-08-28', '1861.22');
    await seed('2026-08-28', '1861.22');
    const result = await record([{ date: '2026-08-28', amount: '1861.22' }]);
    expect(result.errors).toEqual([expect.objectContaining({ code: 'payment_record_mismatch' })]);
    expect(result.added).toEqual([]);
    expect(state.write).not.toHaveBeenCalled();
  });

  it('deduplicates repeated input amounts after normalisation and reports malformed rows without aborting safe rows', async () => {
    const result = await record([
      { date: '2026-09-30', amount: '100' }, { date: '2026-09-30', amount: '100.00' },
      { date: '2026-02-31', amount: '100.00' }, { date: '2026-06-30', amount: 'not money' },
      { date: '2026-04-30', amount: '100', principal: 'NaN' },
    ]);
    expect(result.added).toHaveLength(1);
    expect(result.duplicates).toEqual([{ date: '2026-09-30', amount: '100.00', existingJournalId: null }]);
    expect(result.errors).toHaveLength(3);
    expect((await client.query('SELECT count(*) AS count FROM journal_entries')).rows[0].count).toBe('1');
  });
});
