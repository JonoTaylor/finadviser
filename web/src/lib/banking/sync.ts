/**
 * Banking sync engine. For one connection, pulls fresh transactions
 * from the aggregator for every linked provider_account, dedups via
 * provider_txn_id, and writes journal_entries + book_entries +
 * transaction_metadata in the existing schema. Returns counts so the
 * caller can record a sync_runs row.
 *
 * What this PR (B) does not yet do:
 *   - Pending -> settled status flip on re-sync. Today we ingest both
 *     and the dedup index keeps us idempotent on aggregatorTxnId, but
 *     a status field on journal_entries to flip "pending" rows is
 *     deferred to PR D.
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
import { getDb, schema } from '@/lib/db';
import { gocardless } from './gocardless';
import { bankingRepo } from './repo';
import { accountRepo } from '@/lib/repos';
import type { AggregatorTransaction } from './aggregator';

const { journalEntries, bookEntries, transactionMetadata } = schema;

// On every sync after the first, re-pull a small overlap window before
// last_synced_at so any transactions that were pending on the previous
// run and have since cleared can be reconciled. The dedup index on
// provider_txn_id makes this safe and idempotent.
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
    const dateFrom = sinceIsoFromConnection ?? pa.cutoverDate ?? format(subDays(new Date(), 7), 'yyyy-MM-dd');

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
 * Idempotent insert of a single aggregator transaction. Returns true
 * if a new journal_entry was created, false if the provider_txn_id
 * was already on file (no-op).
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

  // Resolve the contra account (Uncategorized Income/Expense). Both
  // are seeded by migration.sql with is_system=true; cached at module
  // scope across calls within the same invocation.
  const contraAccountId = await resolveContraAccount(parseFloat(txn.amount));

  // Check if we already have this txn. The partial UNIQUE index on
  // journal_entries.provider_txn_id makes this constant-time.
  const existing = await db.execute(sql`
    SELECT id FROM journal_entries WHERE provider_txn_id = ${txn.aggregatorTxnId} LIMIT 1
  `);
  if (existing.rows.length > 0) {
    return false;
  }

  // The amount in book_entries is signed: subject account gets the
  // raw bank amount, contra gets the inverse. journal-balance trigger
  // enforces sum=0.
  const subjectAmount = new Decimal(txn.amount).toFixed(2);
  const contraAmount = new Decimal(txn.amount).neg().toFixed(2);
  const description = (txn.merchantName?.trim() || txn.description.trim() || 'Bank transaction').slice(0, 500);

  const [journal] = await db
    .insert(journalEntries)
    .values({
      date: txn.date,
      description,
      providerTxnId: txn.aggregatorTxnId,
      syncRunId,
    })
    .returning({ id: journalEntries.id });

  await db.insert(bookEntries).values([
    { journalEntryId: journal.id, accountId: internalAccountId, amount: subjectAmount },
    { journalEntryId: journal.id, accountId: contraAccountId,   amount: contraAmount },
  ]);

  await db.insert(transactionMetadata).values({
    journalEntryId: journal.id,
    externalId: txn.aggregatorTxnId,
    transactionType: txn.status,
    merchantName: txn.merchantName,
    bankCategory: txn.bankCategory,
    currency: txn.currency,
    originalAmount: txn.originalAmount,
    originalCurrency: txn.originalCurrency,
    fxRate: txn.fxRate,
    raw: txn.raw,
  });

  return true;
}

// ── Contra-account lookup with module-level caching ────────────────

let cachedContraIncome: number | null = null;
let cachedContraExpense: number | null = null;

async function resolveContraAccount(amount: number): Promise<number> {
  if (amount >= 0) {
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
