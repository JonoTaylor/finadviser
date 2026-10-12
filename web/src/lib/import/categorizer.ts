import { categoryRepo } from '@/lib/repos';
import type { RawTransaction } from '@/lib/types';

export async function categorizeTransactions(
  transactions: RawTransaction[],
): Promise<RawTransaction[]> {
  const rules = (await categoryRepo.getRules()).slice()
    .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id ?? 0) - (b.id ?? 0));

  for (const txn of transactions) {
    if (txn.isDuplicate) continue;
    // Match against description AND merchantName when present — the
    // bank's clean merchant name (e.g. Monzo's "Name" column) often
    // gives a much better signal than the raw description string.
    txn.suggestedCategoryId =
      matchRule(txn.description, rules) ??
      (txn.metadata?.merchantName ? matchRule(txn.metadata.merchantName, rules) : null);
  }

  return transactions;
}

export function matchRule(
  description: string,
  rules: Array<{ pattern: string; categoryId: number; matchType: string | null; source?: string | null }>,
): number | null {
  const descLower = description.toLowerCase();

  for (const rule of rules) {
    const pattern = rule.pattern.toLowerCase();
    const matchType = rule.matchType ?? 'contains';

    // Legacy AI-generated rules were never confirmed by the user.
    // A guess must not silently become an instruction for new imports.
    if (rule.source === 'ai') continue;

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
