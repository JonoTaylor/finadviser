import { fingerprintRepo } from '@/lib/repos';
import type { RawTransaction } from '@/lib/types';

/**
 * Mark transactions as duplicates if their fingerprint already exists for
 * this account, or appears more than once within the same batch.
 *
 * One bulk DB lookup instead of one-per-row — for a 500-row import that's
 * the difference between 500 round-trips and 1.
 */
export async function checkDuplicates(
  transactions: RawTransaction[],
  accountId: number,
): Promise<RawTransaction[]> {
  // De-duplicate the fingerprint list before the IN(...) lookup —
  // shrinks parameter count and query size for large imports without
  // changing behaviour (a fingerprint either exists for the account or
  // it doesn't).
  const fingerprints = [...new Set(transactions.map(t => t.fingerprint))];
  const existingInDb = await fingerprintRepo.findExisting(fingerprints, accountId);

  const seenInBatch = new Set<string>();
  for (const txn of transactions) {
    if (existingInDb.has(txn.fingerprint) || seenInBatch.has(txn.fingerprint)) {
      txn.isDuplicate = true;
    } else {
      seenInBatch.add(txn.fingerprint);
    }
  }

  return transactions;
}
