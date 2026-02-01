import { fingerprintRepo } from '@/lib/repos';
import type { RawTransaction } from '@/lib/types';

export async function checkDuplicates(
  transactions: RawTransaction[],
  accountId: number,
): Promise<RawTransaction[]> {
  const seenInBatch = new Set<string>();

  for (const txn of transactions) {
    if (await fingerprintRepo.exists(txn.fingerprint, accountId)) {
      txn.isDuplicate = true;
    } else if (seenInBatch.has(txn.fingerprint)) {
      txn.isDuplicate = true;
    } else {
      seenInBatch.add(txn.fingerprint);
    }
  }

  return transactions;
}
