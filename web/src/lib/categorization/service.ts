import { randomUUID } from 'node:crypto';
import { categorizeContextBatch } from '@/lib/ai/claude-client';
import { categoryRepo } from '@/lib/repos/category.repo';
import { categorizationRepo } from './repository';
import {
  categorizationContextKey, MAX_PROCESSING_ENTRIES, MODEL_BATCH_SIZE,
  movementReviewReason, needsMovementReview, ruleDecision, validateModelDecisions,
} from './decisions';
import type {
  CategorizationCandidate, CategorizationDecision, CategorizationOptions, CategorizationResult,
} from './types';

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Processing limits must be positive integers.');
  return Math.min(value, maximum);
}

function normalizeOptions(options: CategorizationOptions): CategorizationOptions {
  for (const ids of [options.journalIds, options.syncRunIds]) {
    if (ids !== undefined && (ids.length > 10000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))) {
      throw new Error('Select up to 10,000 valid journal or sync IDs.');
    }
  }
  return {
    ...options,
    journalIds: options.journalIds === undefined ? undefined : [...new Set(options.journalIds)],
    syncRunIds: options.syncRunIds === undefined ? undefined : [...new Set(options.syncRunIds)],
    limit: bounded(options.limit, MAX_PROCESSING_ENTRIES, MAX_PROCESSING_ENTRIES),
    deadlineMs: bounded(options.deadlineMs, 45000, 45000),
    modelTimeoutMs: bounded(options.modelTimeoutMs, 20000, 30000),
  };
}

/**
 * One bounded, leased pass. Only known high-confidence decisions are applied;
 * uncertainty is a durable review item rather than a guessed category.
 * Model failures are reported without discarding deterministic successes.
 */
export async function processCategorization(options: CategorizationOptions = {}): Promise<CategorizationResult> {
  const normalized = normalizeOptions(options);
  const startedAt = Date.now();
  const deadline = startedAt + normalized.deadlineMs!;
  const token = randomUUID();
  const counters = {
    total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, aiNoMatch: 0,
    reviewQueued: 0, conflicts: 0, batches: 0,
  };
  let aiSkippedReason: string | null = null;
  let deferredReason: CategorizationResult['deferredReason'] = null;
  const acquired = await categorizationRepo.acquireLease(token);
  if (!acquired) {
    const counts = await categorizationRepo.counts(normalized);
    return {
      ...counts, ...counters, hasMore: counts.scopeAvailable > 0, busy: true,
      status: 'partial', aiSkippedReason: 'Another data-processing pass is already running.', reviewUrl: '/data', deferredReason: 'busy',
    };
  }

  try {
    const [candidates, categories, rules] = await Promise.all([
      categorizationRepo.listCandidates(normalized), categoryRepo.listAll(), categoryRepo.getRules(),
    ]);
    counters.total = candidates.length;
    const learned = await categorizationRepo.lookupLearned(candidates.map(categorizationContextKey));
    const validCategories = new Set(categories.map(category => category.id));
    const deterministic: CategorizationDecision[] = [];
    const unmatched: CategorizationCandidate[] = [];
    for (const candidate of candidates) {
      const learnedCategoryId = learned.get(categorizationContextKey(candidate));
      if (learnedCategoryId !== undefined && validCategories.has(learnedCategoryId)) {
        deterministic.push({
          journalId: candidate.id, categoryId: learnedCategoryId, confidence: 1, source: 'learned',
          status: needsMovementReview(candidate, learnedCategoryId, categories) ? 'needs_review' : 'applied',
          reason: movementReviewReason(candidate, learnedCategoryId, categories) ?? 'Matches an exact transaction context previously confirmed by you.',
        });
      } else {
        const rule = ruleDecision(candidate, rules, categories);
        if (rule) deterministic.push(rule);
        else unmatched.push(candidate);
      }
    }

    async function persist(decisions: CategorizationDecision[]) {
      if (!decisions.length) return;
      const persisted = await categorizationRepo.persistDecisions(candidates, decisions, token);
      const decisionById = new Map(decisions.map(decision => [decision.journalId, decision]));
      counters.conflicts += decisions.length - persisted.length;
      for (const row of persisted) {
        const decision = decisionById.get(row.journalId)!;
        if (row.status === 'needs_review') {
          counters.reviewQueued++;
          if (decision.source === 'ai') counters.aiNoMatch++;
        } else if (decision.source === 'rule') {
          counters.ruleBased++;
        } else if (decision.source === 'learned') {
          counters.learned++;
        } else {
          counters.aiCategorized++;
        }
      }
    }

    if (Date.now() < deadline) await persist(deterministic);
    else if (candidates.length) {
      aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
      deferredReason = 'time_budget';
    }

    if (unmatched.length > 0 && !aiSkippedReason) {
      if (!process.env.AI_GATEWAY_API_KEY) {
        aiSkippedReason = 'AI categorisation is unavailable because the AI service is not configured.';
        deferredReason = 'model_unavailable';
      } else if (!categories.length) {
        aiSkippedReason = 'Add spending categories before running AI categorisation.';
        deferredReason = 'no_categories';
      } else {
        const modelDeadline = Math.min(deadline, Date.now() + normalized.modelTimeoutMs!);
        for (let offset = 0; offset < unmatched.length; offset += MODEL_BATCH_SIZE) {
          const remainingMs = modelDeadline - Date.now();
          if (remainingMs <= 0) {
            aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
            deferredReason = 'time_budget';
            break;
          }
          const batch = unmatched.slice(offset, offset + MODEL_BATCH_SIZE);
          let decisions: CategorizationDecision[];
          const signal = AbortSignal.timeout(remainingMs);
          try {
            counters.batches++;
            const response = await categorizeContextBatch(batch, categories, signal);
            decisions = validateModelDecisions(response, batch, categories);
          } catch {
            // Provider messages can contain echoed financial data; never log
            // response bodies, prompts or raw provider errors here.
            console.warn('[categorization] model batch unavailable or invalid', { batchSize: batch.length });
            deferredReason = signal.aborted || Date.now() >= modelDeadline ? 'time_budget' : 'model_failed';
            aiSkippedReason = deferredReason === 'time_budget'
              ? 'The processing time budget was reached. Run another pass to continue.'
              : 'AI categorisation could not finish this batch. No model changes were applied for it; run another pass to retry.';
            break;
          }
          if (Date.now() >= modelDeadline) {
            aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
            deferredReason = 'time_budget';
            break;
          }
          // Database errors must propagate: claiming a model failure would
          // hide a failed save and misrepresent which decisions persisted.
          await persist(decisions);
        }
      }
    }

    const counts = await categorizationRepo.counts(normalized);
    const changed = counters.ruleBased + counters.aiCategorized + counters.learned + counters.reviewQueued;
    return {
      ...counts, ...counters, aiSkippedReason, deferredReason, hasMore: counts.scopeAvailable > 0,
      busy: false, status: aiSkippedReason ? (changed ? 'partial' : 'unavailable') : (counts.scopeAvailable > 0 ? 'partial' : 'complete'),
      reviewUrl: '/data',
    };
  } finally {
    await categorizationRepo.releaseLease(token);
  }
}
