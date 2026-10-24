import { AUTO_APPLY_CONFIDENCE, validateModelDecisions } from '@/lib/categorization/decisions';
import { BENCHMARK_CATEGORIES, type CategorizationBenchmarkCase } from './fixtures';

export type CategorizationBenchmarkScore = {
  correct: number;
  total: number;
  unsafeAutoApplied: number;
  invalidBatches: number;
  reviewCount: number | null;
};

/** Inspect raw model choices too: application guards must not conceal an unsafe model. */
export function scoreBenchmarkBatch(response: unknown, cases: readonly CategorizationBenchmarkCase[]): CategorizationBenchmarkScore {
  const expectedById = new Map(cases.map(item => [item.candidate.id, item.expectedCategoryId]));
  const score: CategorizationBenchmarkScore = { correct: 0, total: cases.length, unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: null };
  // Counting obviously unsafe proposals does not make malformed output valid.
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const decisions = (response as { decisions?: unknown }).decisions;
    if (Array.isArray(decisions)) {
      const unsafeIds = new Set<number>();
      for (const item of decisions) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
        const raw = item as { journalId?: unknown; categoryId?: unknown; confidence?: unknown };
        if (typeof raw.journalId === 'number' && expectedById.has(raw.journalId)
          && raw.categoryId !== expectedById.get(raw.journalId) && raw.categoryId !== null && raw.categoryId !== undefined
          && typeof raw.confidence === 'number' && Number.isFinite(raw.confidence) && raw.confidence >= AUTO_APPLY_CONFIDENCE) {
          unsafeIds.add(raw.journalId);
        }
      }
      score.unsafeAutoApplied = unsafeIds.size;
    }
  }
  try {
    const validated = validateModelDecisions(response, cases.map(item => item.candidate), BENCHMARK_CATEGORIES);
    score.reviewCount = validated.filter(item => item.status === 'needs_review').length;
    const raw = (response as { decisions: { journalId: number; categoryId: number | null }[] }).decisions;
    const validatedById = new Map(validated.map(item => [item.journalId, item]));
    score.correct = raw.filter(item => {
      const expected = expectedById.get(item.journalId);
      const checked = validatedById.get(item.journalId)!;
      return item.categoryId === expected && (expected === null ? checked.status === 'needs_review' : checked.status === 'applied');
    }).length;
  } catch {
    // A partial, duplicate-ID or unrelated result does not earn partial credit.
    score.invalidBatches = 1;
  }
  return score;
}
