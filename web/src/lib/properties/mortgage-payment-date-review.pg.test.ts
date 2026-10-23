import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', () => ({ getDb: () => state.db }));
import {
  correctMortgagePaymentDate, isMortgagePaymentIsoDate, isPossibleTruncatedPaymentDate,
  MortgageDateCorrectionConflictError, previewMortgagePaymentDateCorrection,
} from './mortgage-payment-date-review';

describe('mortgage date correction validation', () => {
  it('recognises only real dates and the same-month lost-tens-digit pattern', () => {
    expect(isMortgagePaymentIsoDate('2024-02-29')).toBe(true);
    expect(isMortgagePaymentIsoDate('2026-02-29')).toBe(false);
    expect(isMortgagePaymentIsoDate('2026-04-31')).toBe(false);
    expect(isPossibleTruncatedPaymentDate('2026-08-08', '2026-08-28')).toBe(true);
    expect(isPossibleTruncatedPaymentDate('2026-07-01', '2026-07-31')).toBe(true);
    expect(isPossibleTruncatedPaymentDate('2026-08-08', '2026-09-28')).toBe(false);
    expect(isPossibleTruncatedPaymentDate('2026-08-08', '2026-08-30')).toBe(false);
  });
});

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('reviewed mortgage date corrections in PostgreSQL', () => {
  let client: Client;
  const input = { mortgageId: 11, journalId: 1, correctDate: '2026-08-28', propertyId: 5 };
  beforeAll(async () => {
    client = new Client({ connectionString: url });
    await client.connect();
    await client.query(`
      CREATE TEMP TABLE accounts (id integer PRIMARY KEY, account_type text, name text);
      CREATE TEMP TABLE mortgages (id integer PRIMARY KEY, property_id integer, interest_only boolean);
      CREATE TEMP TABLE journal_entries (id integer PRIMARY KEY, date text, reference text,
        description text, category_id integer, property_id integer, is_transfer boolean);
      CREATE TEMP TABLE book_entries (id integer PRIMARY KEY, journal_entry_id integer,
        account_id integer, amount numeric(14,2));
    `);
    state.db = drizzle(client);
  });
  afterAll(async () => { await client?.end(); });
  beforeEach(async () => {
    state.db = drizzle(client);
    await client.query(`
      TRUNCATE accounts, mortgages, journal_entries, book_entries;
      INSERT INTO accounts VALUES (1, 'ASSET', 'Current account'), (2, 'EXPENSE', 'Mortgage Interest'), (3, 'LIABILITY', 'Mortgage');
      INSERT INTO mortgages VALUES (11, 5, true), (12, 6, true);
      INSERT INTO journal_entries VALUES
        (1, '2026-08-08', 'mortgage_payment:11:2026-08-08:1861.22', 'Mortgage payment - Fixture lender', 7, 5, false);
      INSERT INTO book_entries VALUES (1, 1, 1, -1861.22), (2, 1, 2, 1861.22);
    `);
  });

  it('previews actual evidence without changing data and requires statement confirmation outside the tool', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    expect(review).toMatchObject({ journalId: 1, mortgageId: 11, propertyId: 5,
      date: '2026-08-08', correctDate: '2026-08-28', amount: '1861.22', canCorrect: true, alreadyCorrected: false });
    expect(review.expectedSnapshot).toMatch(/^[a-f0-9]{32}$/);
    expect(review.reason).toContain('does not establish that the recorded date is wrong');
    expect((await client.query('SELECT date FROM journal_entries WHERE id = 1')).rows[0].date).toBe('2026-08-08');
  });

  it('updates only the reviewed date and stable reference while preserving every monetary posting', async () => {
    const before = (await client.query('SELECT * FROM book_entries ORDER BY id')).rows;
    const review = await previewMortgagePaymentDateCorrection(input);
    const result = await correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot });
    expect(result).toMatchObject({ corrected: true, alreadyCorrected: false,
      record: { date: '2026-08-28', reference: 'mortgage_payment:11:2026-08-28:1861.22', alreadyCorrected: true } });
    expect((await client.query('SELECT * FROM book_entries ORDER BY id')).rows).toEqual(before);
    expect((await client.query('SELECT description, category_id, property_id, is_transfer FROM journal_entries WHERE id = 1')).rows[0])
      .toEqual({ description: 'Mortgage payment - Fixture lender', category_id: 7, property_id: 5, is_transfer: false });
    expect(await correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
      .toMatchObject({ corrected: false, alreadyCorrected: true });
    expect((await client.query('SELECT COUNT(*)::int AS count FROM journal_entries')).rows[0].count).toBe(1);
  });

  it('rejects a stale preview after ledger or metadata changes', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    await client.query('UPDATE journal_entries SET category_id = 8 WHERE id = 1');
    await expect(correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
      .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
    expect((await client.query('SELECT date FROM journal_entries WHERE id = 1')).rows[0].date).toBe('2026-08-08');
  });

  it('rejects a preview after the payment posting moves to another bank account', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    await client.query("INSERT INTO accounts VALUES (4, 'ASSET', 'Other current account'); UPDATE book_entries SET account_id = 4 WHERE id = 1");
    await expect(correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
      .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
    expect((await client.query('SELECT date FROM journal_entries WHERE id = 1')).rows[0].date).toBe('2026-08-08');
  });

  it('rechecks posting evidence in the guarded update after its initial read', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    await client.query("INSERT INTO accounts VALUES (4, 'ASSET', 'Other current account')");
    const database = drizzle(client);
    let calls = 0;
    state.db = { execute: async (statement: SQL) => {
      calls++;
      if (calls === 2) await client.query('UPDATE book_entries SET account_id = 4 WHERE id = 1');
      return database.execute(statement);
    } };
    await expect(correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
      .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
    expect((await client.query('SELECT date FROM journal_entries WHERE id = 1')).rows[0].date).toBe('2026-08-08');
    expect((await client.query('SELECT account_id FROM book_entries WHERE id = 1')).rows[0].account_id).toBe(4);
  });

  it('allows only one concurrent correction using the same preview', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    const results = await Promise.allSettled([
      correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }),
      correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled' && result.value.corrected)).toHaveLength(1);
    expect((await client.query('SELECT date, reference FROM journal_entries WHERE id = 1')).rows[0])
      .toEqual({ date: '2026-08-28', reference: 'mortgage_payment:11:2026-08-28:1861.22' });
  });

  it('blocks a correction when another payment already has the proposed stable reference', async () => {
    await client.query(`INSERT INTO journal_entries VALUES
      (2, '2026-08-28', 'mortgage_payment:11:2026-08-28:1861.22', 'Other payment', NULL, 5, false)`);
    const review = await previewMortgagePaymentDateCorrection(input);
    expect(review).toMatchObject({ canCorrect: false });
    expect(review.reason).toContain('Another payment');
    await expect(correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
      .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
  });

  it.each(['wrong_property', 'transfer', 'wrong_reference', 'principal', 'repayment', 'wrong_interest_account', 'duplicate_reference'])
    ('refuses unsupported source records: %s', async kind => {
      if (kind === 'wrong_property') await client.query('UPDATE journal_entries SET property_id = 6 WHERE id = 1');
      if (kind === 'transfer') await client.query('UPDATE journal_entries SET is_transfer = true WHERE id = 1');
      if (kind === 'wrong_reference') await client.query("UPDATE journal_entries SET reference = 'mortgage_payment:12:2026-08-08:1861.22' WHERE id = 1");
      if (kind === 'principal') await client.query('UPDATE book_entries SET amount = 1400 WHERE id = 2; INSERT INTO book_entries VALUES (3,1,3,461.22)');
      if (kind === 'repayment') await client.query('UPDATE mortgages SET interest_only = false WHERE id = 11');
      if (kind === 'wrong_interest_account') await client.query("UPDATE accounts SET name = 'General expenses' WHERE id = 2");
      if (kind === 'duplicate_reference') await client.query("INSERT INTO journal_entries SELECT 2,date,reference,description,category_id,property_id,is_transfer FROM journal_entries WHERE id=1");
      const review = await previewMortgagePaymentDateCorrection(input);
      expect(review.canCorrect).toBe(false);
      await expect(correctMortgagePaymentDate({ ...input, expectedSnapshot: review.expectedSnapshot }))
        .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
    });

  it('binds a preview to its proposed date and rejects cross-property requests', async () => {
    const review = await previewMortgagePaymentDateCorrection(input);
    await expect(correctMortgagePaymentDate({ ...input, correctDate: '2026-08-18', expectedSnapshot: review.expectedSnapshot }))
      .rejects.toBeInstanceOf(MortgageDateCorrectionConflictError);
    await expect(previewMortgagePaymentDateCorrection({ ...input, propertyId: 6 })).rejects.toThrow('does not belong');
  });

  it('flags a correction across 6 April and preserves both affected tax years', async () => {
    await client.query("UPDATE journal_entries SET date = '2026-04-01', reference = 'mortgage_payment:11:2026-04-01:1861.22' WHERE id = 1");
    const april = { ...input, correctDate: '2026-04-21' };
    const review = await previewMortgagePaymentDateCorrection(april);
    expect(review).toMatchObject({ canCorrect: true, taxYearChanged: true, affectedTaxYears: ['2025-26', '2026-27'] });
    expect(review.reason).toContain('recompute both');
    const saved = await correctMortgagePaymentDate({ ...april, expectedSnapshot: review.expectedSnapshot });
    expect(saved.record.date).toBe('2026-04-21');
    expect(saved.record.affectedTaxYears).toEqual(['2025-26', '2026-27']);
    expect(saved.record.taxYearChanged).toBe(true);
  });
});
