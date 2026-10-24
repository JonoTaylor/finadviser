import type { CategorizationResult } from '../types';

export type CategorizationJobStatus = 'queued' | 'running' | 'paused' | 'completed' | 'cancelled';
export type CategorizationJobTotals = Pick<CategorizationResult,
  'total' | 'ruleBased' | 'aiCategorized' | 'learned' | 'reviewQueued' | 'conflicts' | 'batches'>;

export type CategorizationJob = {
  id: string;
  status: CategorizationJobStatus;
  cancelRequested: boolean;
  pauseRequested: boolean;
  countsExact: boolean;
  passes: number;
  totals: CategorizationJobTotals;
  latestResult: CategorizationResult | null;
  counts: { remaining: number; needsReview: number; available: number } | null;
  countsObservedAt: string | null;
  scopeAvailable: number | null;
  maxJournalId: number;
  pauseReason: string | null;
  dispatchIssue: string | null;
  message: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
  leaseExpiresAt: string | null;
};

export type StoredCategorizationJob = Omit<CategorizationJob, 'counts' | 'countsObservedAt' | 'scopeAvailable' | 'message'> & {
  leaseToken: string | null;
  passLimit: number;
};

export type CategorizationJobRunResult = { job: CategorizationJob | null; shouldContinue: boolean; delayMs: number };

export const EMPTY_JOB_TOTALS: CategorizationJobTotals = {
  total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, reviewQueued: 0, conflicts: 0, batches: 0,
};

export const MAX_JOB_PASSES = 200;
