import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';
import { parseCSV } from './csv-parser';
import { getBankConfig } from '@/lib/config/bank-configs';
import type { RawTransactionMetadata } from '@/lib/types';

/**
 * Fill in `transaction_metadata` rows for transactions that already
 * exist as journal entries — typically because the user re-uploads a
 * Monzo CSV after originally importing it under a bank profile that
 * didn't capture merchant / type / external_id.
 *
 * NEVER creates journal entries. NEVER overwrites a non-null metadata
 * field — uses COALESCE(existing, new) semantics so previously-saved
 * values win.
 *
 * Matching strategy, per CSV row:
 *   1. If `transaction_metadata.external_id` already records this row's
 *      Monzo tx_id, that's the canonical match. Used on subsequent
 *      re-runs after the first backfill has populated external_id.
 *   2. Else, match by (date, lower(trim(description)),
 *      account+amount). This mirrors the legacy fingerprint algorithm
 *      so pre-PR-#23 imports still resolve cleanly.
 *   3. Else, return as `unmatched` so the caller can decide whether
 *      to import it as a new transaction (out of scope here).
 */

export interface BackfillUnmatched {
  date: string;
  description: string;
  amount: string;
  externalId: string | null;
  /** Why this row didn't get enriched. */
  reason: 'no_match' | 'ambiguous_external_id';
}

export interface BackfillResult {
  totalRows: number;
  rowsWithMetadata: number;
  matchedExisting: number;
  inserted: number;        // matched + had no metadata row -> a new metadata row was created
  filledFields: number;    // matched + had metadata -> filled NULL fields with new values
  noChange: number;        // matched + had metadata -> nothing to fill (every column already populated)
  unmatched: BackfillUnmatched[];
}

interface MetadataPayload {
  journalEntryId: number;
  externalId: string | null;
  transactionTime: string | null;
  transactionType: string | null;
  merchantName: string | null;
  merchantEmoji: string | null;
  bankCategory: string | null;
  currency: string | null;
  localAmount: string | null;
  localCurrency: string | null;
  notes: string | null;
  address: string | null;
  receiptUrl: string | null;
  raw: Record<string, unknown> | null;
}

function toPayload(journalEntryId: number, md: RawTransactionMetadata): MetadataPayload {
  return {
    journalEntryId,
    externalId: md.externalId ?? null,
    transactionTime: md.time ?? null,
    transactionType: md.type ?? null,
    merchantName: md.merchantName ?? null,
    merchantEmoji: md.merchantEmoji ?? null,
    bankCategory: md.bankCategory ?? null,
    currency: md.currency ?? null,
    localAmount: md.localAmount ?? null,
    localCurrency: md.localCurrency ?? null,
    notes: md.notes ?? null,
    address: md.address ?? null,
    receiptUrl: md.receiptUrl ?? null,
    raw: md.raw ?? null,
  };
}

export async function backfillMetadata(
  csvContent: string,
  bankConfigName: string,
  accountId: number,
): Promise<BackfillResult> {
  const config = getBankConfig(bankConfigName);
  if (!config) throw new Error(`Unknown bank config: ${bankConfigName}`);

  const txns = await parseCSV(csvContent, config);
  const result: BackfillResult = {
    totalRows: txns.length,
    rowsWithMetadata: 0,
    matchedExisting: 0,
    inserted: 0,
    filledFields: 0,
    noChange: 0,
    unmatched: [],
  };

  // Skip rows that contributed no metadata at all — there's nothing
  // to backfill.
  const candidates = txns.filter(t => t.metadata !== null && t.metadata !== undefined);
  result.rowsWithMetadata = candidates.length;
  if (candidates.length === 0) return result;

  const db = getDb();

  // Pass 1: bulk-look-up existing matches by external_id. One round-trip
  // for the whole file rather than N.
  //
  // The `external_id` column is indexed but not unique (a future bank
  // could legitimately re-use the same id namespace, so we don't want
  // to enforce uniqueness at the schema level today). If the DB
  // already holds more than one journal under the same external_id,
  // treat that id as ambiguous: don't match, surface in `unmatched`
  // with a reason hint so the user knows why we skipped it.
  const externalIds = Array.from(
    new Set(candidates.map(t => t.metadata!.externalId).filter((v): v is string => Boolean(v))),
  );
  const externalIdMatches = new Map<string, number>();
  const ambiguousExternalIds = new Set<string>();
  if (externalIds.length > 0) {
    const rows = await db.execute(sql`
      SELECT journal_entry_id, external_id
      FROM transaction_metadata
      WHERE external_id IN (${sql.join(externalIds.map(id => sql`${id}`), sql`, `)})
    `);
    const byExternalId = new Map<string, number[]>();
    for (const r of rows.rows) {
      const list = byExternalId.get(r.external_id as string) ?? [];
      list.push(r.journal_entry_id as number);
      byExternalId.set(r.external_id as string, list);
    }
    for (const [extId, list] of byExternalId) {
      if (list.length === 1) externalIdMatches.set(extId, list[0]);
      else ambiguousExternalIds.add(extId);
    }
  }

  // Pass 2: for rows we couldn't resolve via external_id, fall back
  // to the legacy heuristic — (date, description, amount) on this
  // account. We bulk-fetch every journal entry on this account that
  // shares a date with any unresolved row, then match in memory by
  // (date, lower(trim(description)), amount). One round-trip again.
  const unresolved = candidates.filter(t => {
    const ext = t.metadata!.externalId;
    return !ext || !externalIdMatches.has(ext);
  });

  // Fingerprint key built from the same triple the legacy fingerprint
  // helper hashed: date, normalised description, amount.
  //
  // Amount is normalised through Decimal.toString() on both sides so
  // a Postgres `numeric::text` cast (which preserves trailing zeros —
  // "10.00") matches a CSV-derived value that doesn't ("10").
  //
  // Multiple journals can share the same triple (e.g. two identical
  // coffee purchases on the same day) — the map value is therefore a
  // list of candidate journal ids. Each backfilled CSV row claims one
  // entry off the list via shift() so duplicates aren't all collapsed
  // onto the same journal.
  type Triple = string;
  const triple = (date: string, description: string, amount: string): Triple => {
    let normalisedAmount: string;
    try {
      normalisedAmount = new Decimal(amount).toString();
    } catch {
      normalisedAmount = amount;
    }
    return `${date}|${description.toLowerCase().trim()}|${normalisedAmount}`;
  };

  const tripleMatches = new Map<Triple, number[]>();
  if (unresolved.length > 0) {
    const dates = Array.from(new Set(unresolved.map(t => t.date)));
    const candidateRows = await db.execute(sql`
      SELECT je.id, je.date, je.description, be.amount::text AS amount
      FROM journal_entries je
      JOIN book_entries be ON be.journal_entry_id = je.id
      WHERE be.account_id = ${accountId}
        AND je.date IN (${sql.join(dates.map(d => sql`${d}`), sql`, `)})
    `);
    for (const r of candidateRows.rows) {
      const key = triple(r.date as string, r.description as string, r.amount as string);
      const list = tripleMatches.get(key) ?? [];
      list.push(r.id as number);
      tripleMatches.set(key, list);
    }
  }

  // Pass 3: build the upsert payloads + record unmatched.
  const payloads: MetadataPayload[] = [];
  for (const txn of candidates) {
    const md = txn.metadata!;
    let journalId: number | null = null;

    if (md.externalId) {
      if (ambiguousExternalIds.has(md.externalId)) {
        // DB has >1 journal under this tx_id — refuse to guess.
        result.unmatched.push({
          date: txn.date,
          description: txn.description,
          amount: txn.amount,
          externalId: md.externalId,
          reason: 'ambiguous_external_id',
        });
        continue;
      }
      const found = externalIdMatches.get(md.externalId);
      if (found !== undefined) journalId = found;
    }
    if (journalId === null) {
      // shift() so each journal id is claimed by at most one CSV row —
      // protects the duplicate-transaction-on-same-day case from
      // silently collapsing onto a single journal.
      const list = tripleMatches.get(triple(txn.date, txn.description, txn.amount));
      if (list && list.length > 0) journalId = list.shift()!;
    }

    if (journalId === null) {
      result.unmatched.push({
        date: txn.date,
        description: txn.description,
        amount: txn.amount,
        externalId: md.externalId ?? null,
        reason: 'no_match',
      });
      continue;
    }

    result.matchedExisting++;
    payloads.push(toPayload(journalId, md));
  }

  if (payloads.length === 0) return result;

  // Dedupe by journalEntryId. A single CSV file CAN map two rows to
  // the same journal — most plausibly when the user has the same
  // file with a duplicated row, or when the matching falls through
  // to a different lookup path for two CSV rows pointing at the same
  // transaction. Postgres' `INSERT … VALUES … ON CONFLICT DO UPDATE`
  // rejects a single statement that would touch the same conflict
  // target twice ("cannot affect row a second time"), so we have to
  // collapse before the upsert. Merge with COALESCE-in-JS — first
  // payload wins, later payloads only fill its NULLs.
  const dedupedByJournal = new Map<number, MetadataPayload>();
  for (const p of payloads) {
    const existing = dedupedByJournal.get(p.journalEntryId);
    if (!existing) {
      dedupedByJournal.set(p.journalEntryId, p);
      continue;
    }
    dedupedByJournal.set(p.journalEntryId, {
      journalEntryId: p.journalEntryId,
      externalId:       existing.externalId       ?? p.externalId,
      transactionTime:  existing.transactionTime  ?? p.transactionTime,
      transactionType:  existing.transactionType  ?? p.transactionType,
      merchantName:     existing.merchantName     ?? p.merchantName,
      merchantEmoji:    existing.merchantEmoji    ?? p.merchantEmoji,
      bankCategory:     existing.bankCategory     ?? p.bankCategory,
      currency:         existing.currency         ?? p.currency,
      localAmount:      existing.localAmount      ?? p.localAmount,
      localCurrency:    existing.localCurrency    ?? p.localCurrency,
      notes:            existing.notes            ?? p.notes,
      address:          existing.address          ?? p.address,
      receiptUrl:       existing.receiptUrl       ?? p.receiptUrl,
      raw:              existing.raw              ?? p.raw,
    });
  }
  const dedupedPayloads = Array.from(dedupedByJournal.values());

  // Pass 4: figure out which payloads will create a new metadata row
  // vs which will update an existing one — for the response counts.
  // (The actual write below is a single upsert; we just want to tell
  // the user what happened.)
  const journalIds = dedupedPayloads.map(p => p.journalEntryId);
  const existingRows = await db.execute(sql`
    SELECT journal_entry_id,
           external_id, transaction_time, transaction_type, merchant_name,
           merchant_emoji, bank_category, currency, local_amount,
           local_currency, notes, address, receipt_url, raw
    FROM transaction_metadata
    WHERE journal_entry_id IN (${sql.join(journalIds.map(id => sql`${id}`), sql`, `)})
  `);
  const existingByJournal = new Map<number, Record<string, unknown>>();
  for (const r of existingRows.rows) {
    existingByJournal.set(r.journal_entry_id as number, r);
  }

  const FILLABLE_KEYS = [
    ['external_id', 'externalId'],
    ['transaction_time', 'transactionTime'],
    ['transaction_type', 'transactionType'],
    ['merchant_name', 'merchantName'],
    ['merchant_emoji', 'merchantEmoji'],
    ['bank_category', 'bankCategory'],
    ['currency', 'currency'],
    ['local_amount', 'localAmount'],
    ['local_currency', 'localCurrency'],
    ['notes', 'notes'],
    ['address', 'address'],
    ['receipt_url', 'receiptUrl'],
    ['raw', 'raw'],
  ] as const;

  for (const p of dedupedPayloads) {
    const existing = existingByJournal.get(p.journalEntryId);
    if (!existing) {
      result.inserted++;
      continue;
    }
    let filledThisRow = false;
    for (const [snake, camel] of FILLABLE_KEYS) {
      const existingVal = existing[snake];
      const newVal = p[camel];
      if ((existingVal === null || existingVal === undefined) && newVal !== null && newVal !== undefined) {
        filledThisRow = true;
        break;
      }
    }
    if (filledThisRow) result.filledFields++;
    else result.noChange++;
  }

  // Pass 5: single upsert with COALESCE — never overwrite a
  // previously-saved non-null field.
  const insertValues = dedupedPayloads.map(p => sql`(
    ${p.journalEntryId},
    ${p.externalId},
    ${p.transactionTime},
    ${p.transactionType},
    ${p.merchantName},
    ${p.merchantEmoji},
    ${p.bankCategory},
    ${p.currency},
    ${p.localAmount},
    ${p.localCurrency},
    ${p.notes},
    ${p.address},
    ${p.receiptUrl},
    ${p.raw === null ? null : sql`${JSON.stringify(p.raw)}::jsonb`}
  )`);

  await db.execute(sql`
    INSERT INTO transaction_metadata (
      journal_entry_id, external_id, transaction_time, transaction_type,
      merchant_name, merchant_emoji, bank_category, currency,
      local_amount, local_currency, notes, address, receipt_url, raw
    )
    VALUES ${sql.join(insertValues, sql`, `)}
    ON CONFLICT (journal_entry_id) DO UPDATE SET
      external_id      = COALESCE(transaction_metadata.external_id, EXCLUDED.external_id),
      transaction_time = COALESCE(transaction_metadata.transaction_time, EXCLUDED.transaction_time),
      transaction_type = COALESCE(transaction_metadata.transaction_type, EXCLUDED.transaction_type),
      merchant_name    = COALESCE(transaction_metadata.merchant_name, EXCLUDED.merchant_name),
      merchant_emoji   = COALESCE(transaction_metadata.merchant_emoji, EXCLUDED.merchant_emoji),
      bank_category    = COALESCE(transaction_metadata.bank_category, EXCLUDED.bank_category),
      currency         = COALESCE(transaction_metadata.currency, EXCLUDED.currency),
      local_amount     = COALESCE(transaction_metadata.local_amount, EXCLUDED.local_amount),
      local_currency   = COALESCE(transaction_metadata.local_currency, EXCLUDED.local_currency),
      notes            = COALESCE(transaction_metadata.notes, EXCLUDED.notes),
      address          = COALESCE(transaction_metadata.address, EXCLUDED.address),
      receipt_url      = COALESCE(transaction_metadata.receipt_url, EXCLUDED.receipt_url),
      raw              = COALESCE(transaction_metadata.raw, EXCLUDED.raw)
  `);

  return result;
}
