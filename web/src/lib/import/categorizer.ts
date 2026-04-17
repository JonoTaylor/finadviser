import { categoryRepo } from '@/lib/repos';
import { capInput, isSafeRegex } from '@/lib/utils/regex-safety';
import type { RawTransaction } from '@/lib/types';

export async function categorizeTransactions(
  transactions: RawTransaction[],
): Promise<RawTransaction[]> {
  const rules = await categoryRepo.getRules();

  for (const txn of transactions) {
    if (txn.isDuplicate) continue;
    txn.suggestedCategoryId = matchRule(txn.description, rules);
  }

  return transactions;
}

export function matchRule(
  description: string,
  rules: Array<{ pattern: string; categoryId: number; matchType: string | null }>,
): number | null {
  const descLower = description.toLowerCase();

  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase();
    const matchType = rule.matchType ?? 'contains';

    if (matchType === 'exact' && descLower === pattern) {
      return rule.categoryId;
    } else if (matchType === 'startswith' && descLower.startsWith(pattern)) {
      return rule.categoryId;
    } else if (matchType === 'contains' && descLower.includes(pattern)) {
      return rule.categoryId;
    } else if (matchType === 'regex') {
      // Skip patterns that fail the ReDoS heuristic — they should have been
      // rejected at rule-creation time, but an older rule may still be on disk.
      if (!isSafeRegex(rule.pattern).ok) continue;
      try {
        if (new RegExp(rule.pattern, 'i').test(capInput(description))) {
          return rule.categoryId;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}
