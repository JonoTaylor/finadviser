import { processCategorization } from '@/lib/categorization/service';

const REVIEW_URL = '/data';

/** Persisted transactions survive any failure in this optional processing step. */
export type DeferredCategorization = {
  status: 'unavailable';
  total: number | null;
  ruleBased: number | null;
  aiCategorized: number | null;
  learned: number | null;
  aiNoMatch: number | null;
  reviewQueued: number | null;
  conflicts: number | null;
  remaining: null;
  needsReview: null;
  available: null;
  hasMore: null;
  aiSkippedReason: string;
  batches: number | null;
  busy: false;
  reviewUrl: string;
};

export type IngestionCategorization =
  | (Awaited<ReturnType<typeof processCategorization>> & { reviewUrl: string })
  | DeferredCategorization;

export function deferredCategorization(reason: string, activityUnknown = false): DeferredCategorization {
  const activity = activityUnknown ? null : 0;
  return {
    status: 'unavailable',
    total: activity,
    ruleBased: activity,
    aiCategorized: activity,
    learned: activity,
    aiNoMatch: activity,
    reviewQueued: activity,
    conflicts: activity,
    // A failed read or deferred run cannot claim the backlog is empty.
    remaining: null,
    needsReview: null,
    available: null,
    hasMore: null,
    aiSkippedReason: reason,
    batches: activity,
    busy: false,
    reviewUrl: REVIEW_URL,
  };
}

export async function processSavedTransactions(
  options: Parameters<typeof processCategorization>[0],
): Promise<IngestionCategorization> {
  try {
    return { ...await processCategorization(options), reviewUrl: REVIEW_URL };
  } catch {
    // Never include financial descriptions or provider error bodies in logs.
    console.warn('[categorization] Saved transactions await processing.');
    // Some decisions may already have committed before a later read or
    // lease-release failed. Their counters are unknown, rather than zero.
    return deferredCategorization('processing_failed', true);
  }
}
