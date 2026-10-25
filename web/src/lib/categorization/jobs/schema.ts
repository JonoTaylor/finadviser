import { z } from 'zod';

const count = z.number().int().nonnegative();
const resultSchema = z.object({
  remaining: count, needsReview: count, available: count,
  total: count, ruleBased: count, aiCategorized: count, learned: count, aiNoMatch: count,
  reviewQueued: count, conflicts: count, aiSkippedReason: z.string().nullable(), hasMore: z.boolean(),
  status: z.enum(['complete', 'partial', 'unavailable']), batches: count, busy: z.boolean(),
  reviewUrl: z.literal('/data'),
  deferredReason: z.enum(['time_budget', 'model_unavailable', 'model_failed', 'no_categories', 'busy']).nullable().optional(),
  scopeAvailable: count.optional(),
  reviewsRechecked: count.optional(),
}).strip();

export const categorizationJobSchema = z.object({
  id: z.uuid(), status: z.enum(['queued', 'running', 'paused', 'completed', 'cancelled']),
  cancelRequested: z.boolean(), pauseRequested: z.boolean(), countsExact: z.boolean(), passes: count,
  totals: z.object({ total: count, ruleBased: count, aiCategorized: count, learned: count, reviewQueued: count, conflicts: count, batches: count }).strict(),
  latestResult: resultSchema.nullable(),
  counts: z.object({ remaining: count, needsReview: count, available: count }).strict().nullable(),
  countsObservedAt: z.iso.datetime({ offset: true }).nullable(),
  scopeAvailable: count.nullable(), maxJournalId: count,
  pauseReason: z.string().max(100).nullable(), dispatchIssue: z.string().max(500).nullable(), message: z.string().max(1000).nullable(),
  createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }),
  finishedAt: z.iso.datetime({ offset: true }).nullable(), leaseExpiresAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();
