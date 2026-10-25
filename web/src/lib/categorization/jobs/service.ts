import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { categorizationRepo } from '../repository';
import { processCategorization } from '../service';
import type { CategorizationResult } from '../types';
import { categorizationJobRepo } from './repository';
import type { CategorizationJob, CategorizationJobRunResult, StoredCategorizationJob } from './types';

const jobIdSchema = z.uuid();
const WORKER_BUDGET_MS = 75_000;
const FINISH_MARGIN_MS = 4_000;
// A fresh pass needs the normal 20-second model allowance plus database time.
// Hand off the tail of a hop instead of manufacturing a short, zero-progress
// model timeout which would otherwise pause an otherwise healthy job.
const MIN_PASS_MS = 25_000;

function validateId(id: string): string {
  return jobIdSchema.parse(id);
}

function jobMessage(job: StoredCategorizationJob, counts: CategorizationJob['counts']): string | null {
  if (job.cancelRequested && job.status === 'running') return 'Stopping after the current pass. Completed decisions remain saved.';
  if (job.pauseRequested && job.status === 'running') return 'Pausing after the current pass. Completed decisions remain saved.';
  if (job.status === 'completed') return `Automatic processing for this run is finished.${counts ? ` ${counts.needsReview} records still need review.` : ' Review coverage could not be loaded.'}`;
  if (job.status === 'cancelled') return 'Processing was cancelled. Decisions saved before it stopped remain in your records.';
  if (job.status !== 'paused') return job.countsExact ? null : 'An interrupted pass has an unconfirmed count. Totals show only acknowledged decisions; the live backlog is checked separately.';
  const reasons: Record<string, string> = {
    user_paused: 'Processing is paused. Resume when you want to continue.',
    model_unavailable: 'AI processing is not configured or available. Completed decisions remain saved.',
    model_failed: 'The AI service could not complete a batch. Processing is paused; completed decisions remain saved.',
    no_categories: 'Add spending categories before resuming automatic processing.',
    no_progress: 'Processing paused because the last pass made no progress. Review the remaining records before resuming.',
    conflicts: 'Records changed during processing. Their newer versions were preserved; review the latest state before resuming.',
    processing_failed: 'A processing pass could not be confirmed. Check current records before resuming. Totals include only acknowledged passes.',
    processing_limit: 'This run reached its automatic pass limit. Check the saved progress, then resume to authorise another bounded run.',
  };
  return reasons[job.pauseReason ?? ''] ?? 'Processing is paused. Review its status before resuming.';
}

async function present(stored: StoredCategorizationJob | null): Promise<CategorizationJob | null> {
  if (!stored) return null;
  let counts: CategorizationJob['counts'] = null;
  let countsObservedAt: string | null = null;
  let scopeAvailable: number | null = null;
  try {
    const fresh = await categorizationRepo.counts({ maxJournalId: stored.maxJournalId });
    if ([fresh.remaining, fresh.needsReview, fresh.available, fresh.scopeAvailable].every(value => Number.isSafeInteger(value) && value >= 0)) {
      counts = { remaining: fresh.remaining, needsReview: fresh.needsReview, available: fresh.available };
      scopeAvailable = fresh.scopeAvailable;
      countsObservedAt = new Date().toISOString();
    }
  } catch { /* Unavailable coverage remains unknown rather than a fabricated zero. */ }
  const { leaseToken, passLimit, ...job } = stored;
  void leaseToken;
  void passLimit;
  return { ...job, counts, countsObservedAt, scopeAvailable, message: jobMessage(stored, counts) };
}

export async function startCategorizationJob(): Promise<CategorizationJob> {
  return (await present(await categorizationJobRepo.start(randomUUID())))!;
}

export async function getCategorizationJob(id?: string): Promise<CategorizationJob | null> {
  return present(await categorizationJobRepo.get(id === undefined ? undefined : validateId(id)));
}

export async function pauseCategorizationJob(id: string): Promise<CategorizationJob | null> {
  return present(await categorizationJobRepo.control(validateId(id), 'pause'));
}

export async function cancelCategorizationJob(id: string): Promise<CategorizationJob | null> {
  return present(await categorizationJobRepo.control(validateId(id), 'cancel'));
}

export async function resumeCategorizationJob(id: string): Promise<CategorizationJob | null> {
  return present(await categorizationJobRepo.control(validateId(id), 'resume'));
}

export async function recordCategorizationDispatch(id: string, accepted: boolean, issue: string | null): Promise<void> {
  if (issue !== null && (typeof issue !== 'string' || issue.length > 500)) throw new Error('Invalid processing dispatch status.');
  await categorizationJobRepo.recordDispatch(validateId(id), accepted, issue);
}

function nextState(result: CategorizationResult): { status: 'queued' | 'paused' | 'completed'; reason: string | null } {
  if (result.busy) return { status: 'queued', reason: null };
  if (result.conflicts > 0) return { status: 'paused', reason: 'conflicts' };
  if (result.aiSkippedReason && result.deferredReason !== 'time_budget') return { status: 'paused', reason: result.deferredReason ?? 'model_failed' };
  if (!result.hasMore) return { status: 'completed', reason: null };
  const progress = result.ruleBased + result.aiCategorized + result.learned + result.reviewQueued + (result.reviewsRechecked ?? 0);
  return progress > 0 ? { status: 'queued', reason: null } : { status: 'paused', reason: 'no_progress' };
}

/** One leased hop; the transport is responsible for dispatching queued continuation. */
async function runSlice(id: string, deadline: number): Promise<CategorizationJobRunResult> {
  const token = randomUUID();
  let stored = await categorizationJobRepo.claim(id, token);
  if (!stored || stored.status !== 'running' || stored.leaseToken !== token) {
    const job = await present(stored ?? await categorizationJobRepo.get(id));
    return { job, shouldContinue: job?.status === 'queued', delayMs: 5_000 };
  }
  let delayMs = 0;
  try {
    while (stored.status === 'running' && Date.now() + MIN_PASS_MS + FINISH_MARGIN_MS < deadline) {
      const passId = randomUUID();
      if (!await categorizationJobRepo.beginPass(id, token, passId)) break;
      // A delayed claim/insert must not start financial work after the hop's
      // deadline. Releasing an unacknowledged pass records its uncertainty.
      if (Date.now() + MIN_PASS_MS + FINISH_MARGIN_MS >= deadline) break;
      let result: CategorizationResult;
      try {
        const availableMs = Math.max(1, deadline - Date.now() - FINISH_MARGIN_MS);
        result = await processCategorization({
          source: 'scheduled', limit: 100, maxJournalId: stored.maxJournalId,
          deadlineMs: Math.min(45_000, availableMs), modelTimeoutMs: Math.min(20_000, availableMs),
        });
      } catch {
        // The processor may have saved earlier batches. Preserve uncertainty
        // and never replay this pass or count it as zero financial changes.
        await categorizationJobRepo.failPass(id, token, passId);
        break;
      }
      const next = nextState(result);
      const updated = await categorizationJobRepo.finishPass(id, token, passId, result, next.status, next.reason);
      if (!updated) break;
      stored = updated;
      if (result.busy) { delayMs = 5_000; break; }
      if (stored.status !== 'running') break;
    }
  } finally {
    // Token guards prevent an expired worker from releasing its replacement.
    await categorizationJobRepo.release(id, token);
  }
  const job = await getCategorizationJob(id);
  return { job, shouldContinue: job?.status === 'queued', delayMs };
}

export async function runCategorizationJob(id: string, options: { budgetMs?: number } = {}): Promise<CategorizationJobRunResult> {
  validateId(id);
  if (options.budgetMs !== undefined && (!Number.isSafeInteger(options.budgetMs) || options.budgetMs <= 0)) throw new Error('Invalid processing worker budget.');
  const budget = Math.min(options.budgetMs ?? WORKER_BUDGET_MS, WORKER_BUDGET_MS);
  const deadline = Date.now() + budget;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      runSlice(id, deadline),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('The processing worker exceeded its execution budget. Its last pass may be unconfirmed.')), budget);
      }),
    ]);
  } finally { clearTimeout(timeout); }
}
