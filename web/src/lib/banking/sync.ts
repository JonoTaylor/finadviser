/**
 * Banking sync engine. For one connection, pulls fresh transactions
 * from the aggregator for every linked provider_account, dedups via
 * provider_txn_id, and writes journal_entries + book_entries +
 * transaction_metadata in the existing schema. Returns counts so the
 * caller can record a sync_runs row.
 *
 * Atomicity: each transaction lands via the `ingest_bank_transaction`
 * Postgres function, so the journal entry + the two balanced book
 * entries + the transaction_metadata row commit together or not at
 * all. The function is idempotent on `provider_txn_id`: a re-sync
 * returns `was_inserted = false` for a row already on file and
 * skips the side-effect inserts.
 *
 * What this PR (B) does not yet do:
 *   - Pending -> settled status flip on re-sync. Today we ingest both
 *     and the dedup keeps us idempotent, but a status field on
 *     journal_entries to flip "pending" rows is deferred to PR D.
 *   - AI categorisation pass. Inserts go into the system "Bank" /
 *     "Uncategorized Income/Expense" accounts and the user can pick
 *     up the categorisation pass via /chat as before.
 *   - Cutover-with-backfill collision detection against historical
 *     manual CSV entries. Today the sync starts from
 *     provider_account.cutover_date forward; the backfill option is
 *     in PR B.5.
 */

import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { format, subDays } from 'date-fns';
import { getDb } from '@/lib/db';
import { gocardless } from './gocardless';
import { bankingRepo } from './repo';
import { accountRepo } from '@/lib/repos';
import type { AggregatorTransaction } from './aggregator';

// On every sync after the first, re-pull a small overlap window before
// last_synced_at so any transactions that were pending on the previous
// run and have since cleared can be reconciled. The dedup primitive
// (ingest_bank_transaction's idempotent insert) makes this safe.
const RESYNC_OVERLAP_DAYS = 7;

export interface SyncOutcome {
  txnsAdded: number;
  txnsUpdated: number;  // 0 in PR B; reserved for the pending->settled flip
}

export async function syncConnection(connectionId: number, syncRunId: number): Promise<SyncOutcome> {
  const conn = await bankingRepo.getConnection(connectionId);
  if (!conn) throw new Error(`Connection ${connectionId} not found`);
  if (conn.status !== 'active' && conn.status !== 'expiring') {
    throw new Error(`Connection ${connectionId} is in status ${conn.status}; sync aborted`);
  }

  const providerAccounts = await bankingRepo.listProviderAccounts(connectionId);
  if (providerAccounts.length === 0) {
    return { txnsAdded: 0, txnsUpdated: 0 };
  }

  let totalAdded = 0;

  const todayIso = format(new Date(), 'yyyy-MM-dd');
  const sinceIsoFromConnection = conn.lastSyncedAt
    ? format(subDays(conn.lastSyncedAt, RESYNC_OVERLAP_DAYS), 'yyyy-MM-dd')
    : null;

  for (const pa of providerAccounts) {
    // First-sync window: cutover_date if set, else last 7 days only
    // (a conservative default so an inadvertent connect doesn't pull
    // 2 years of history without explicit consent from the user).
    // Subsequent syncs: last_synced_at minus the overlap window.
    //
    // cutover_date wins over the lastSyncedAt window when it's later
    // than the overlap-window start, otherwise an account mapped
    // with a cutover after the last sync would have its cutover
    // ignored.
    const overlapStart = sinceIsoFromConnection ?? format(subDays(new Date(), 7), 'yyyy-MM-dd');
    const dateFrom = pa.cutoverDate && pa.cutoverDate > overlapStart
      ? pa.cutoverDate
      : overlapStart;

    const txns = await gocardless.listTransactions({
      aggregatorAccountRef: pa.aggregatorAccountRef,
      dateFrom,
      dateTo: todayIso,
    });

    for (const txn of txns) {
      const inserted = await ingestTransaction(txn, pa.accountId, syncRunId);
      if (inserted) totalAdded += 1;
    }
  }

  return { txnsAdded: totalAdded, txnsUpdated: 0 };
}

/**
 * Idempotent insert of a single aggregator transaction via the
 * `ingest_bank_transaction` Postgres function. Returns true if a
 * new journal_entry was created, false if `provider_txn_id` was
 * already on file (no-op).
 *
 * Double-entry shape: amount > 0 (money in) credits the asset
 * account and debits Uncategorized Income; amount < 0 (money out)
 * credits the asset and debits Uncategorized Expense. Sign matches
 * the bank's perspective.
 */
async function ingestTransaction(
  txn: AggregatorTransaction,
  internalAccountId: number,
  syncRunId: number,
): Promise<boolean> {
  const db = getDb();

  // Decimal for the sign check too, matching the rest of this
  // function's monetary handling. parseFloat works in practice for
  // sign but mixing primitives with Decimal makes the data flow
  // harder to reason about.
  const amount = new Decimal(txn.amount);
  const contraAccountId = await resolveContraAccount(amount.gte(0));

  const description = (txn.merchantName?.trim() || txn.description.trim() || 'Bank transaction').slice(0, 500);
  const amountStr = amount.toFixed(2);

  // Normalise nullable money strings; Decimal-format anything present.
  const originalAmount = txn.originalAmount ? new Decimal(txn.originalAmount).toFixed(2) : null;
  const fxRate = txn.fxRate ? new Decimal(txn.fxRate).toFixed(8) : null;

  const result = await db.execute(sql`
    SELECT journal_id, was_inserted
      FROM ingest_bank_transaction(
        ${txn.aggregatorTxnId}::text,
        ${internalAccountId}::integer,
        ${contraAccountId}::integer,
        ${txn.date}::text,
        ${description}::text,
        ${amountStr}::numeric,
        ${syncRunId}::integer,
        ${txn.aggregatorTxnId}::text,
        ${txn.status}::text,
        ${txn.merchantName}::text,
        ${txn.bankCategory}::text,
        ${txn.currency}::text,
        ${originalAmount}::numeric,
        ${txn.originalCurrency}::text,
        ${fxRate}::numeric,
        ${JSON.stringify(txn.raw)}::jsonb
      )
  `);
  if (result.rows.length === 0) return false;
  return Boolean(result.rows[0].was_inserted);
}

// ── Contra-account lookup with module-level caching ────────────────

let cachedContraIncome: number | null = null;
let cachedContraExpense: number | null = null;

async function resolveContraAccount(isCredit: boolean): Promise<number> {
  if (isCredit) {
    if (cachedContraIncome !== null) return cachedContraIncome;
    const acc = await accountRepo.getByName('Uncategorized Income');
    if (!acc) throw new Error('System "Uncategorized Income" account is missing; re-run the migration');
    cachedContraIncome = acc.id;
    return acc.id;
  }
  if (cachedContraExpense !== null) return cachedContraExpense;
  const acc = await accountRepo.getByName('Uncategorized Expense');
  if (!acc) throw new Error('System "Uncategorized Expense" account is missing; re-run the migration');
  cachedContraExpense = acc.id;
  return acc.id;
}
