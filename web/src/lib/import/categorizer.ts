import { categoryRepo } from '@/lib/repos';
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
      try {
        if (new RegExp(rule.pattern, 'i').test(description)) {
          return rule.categoryId;
        }
      } catch {
        continue;
      }
    }
  }

  return null;
}
