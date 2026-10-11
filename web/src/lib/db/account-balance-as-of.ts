import { sql } from 'drizzle-orm';

/**
 * Signed balance at a calendar date, using the canonical balance view minus
 * future postings. Callers join accounts as `a` and v_account_balances as `v`.
 * A future credit must be subtracted with its sign, just like a future debit.
 */
export function accountBalanceAsOf(asOf: string) {
  return sql`(COALESCE(v.balance, 0) - COALESCE((
    SELECT SUM(future_book.amount::numeric)
    FROM book_entries future_book
    JOIN journal_entries future_journal ON future_journal.id = future_book.journal_entry_id
    WHERE future_book.account_id = a.id AND future_journal.date > ${asOf}
  ), 0))`;
}
