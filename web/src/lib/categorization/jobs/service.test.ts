import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationResult } from '../types';
import { EMPTY_JOB_TOTALS, type StoredCategorizationJob } from './types';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), get: vi.fn(), claim: vi.fn(), beginPass: vi.fn(), finishPass: vi.fn(), release: vi.fn(), failPass: vi.fn(), control: vi.fn(), recordDispatch: vi.fn(),
  counts: vi.fn(), process: vi.fn(),
}));
vi.mock('./repository', () => ({ categorizationJobRepo: mocks }));
vi.mock('../repository', () => ({ categorizationRepo: { counts: mocks.counts } }));
vi.mock('../service', () => ({ processCategorization: mocks.process }));
import { getCategorizationJob, runCategorizationJob, startCategorizationJob } from './service';

const id = 'e5dc57cc-19e1-425c-bbeb-e04cc8ee0f60';
let job: StoredCategorizationJob;
const result = (overrides: Partial<CategorizationResult> = {}): CategorizationResult => ({
  total: 100, ruleBased: 1, aiCategorized: 32, learned: 0, reviewQueued: 23, aiNoMatch: 23,
  conflicts: 0, batches: 10, remaining: 1103, available: 764, needsReview: 339, scopeAvailable: 764,
  aiSkippedReason: 'The processing time budget was reached.', deferredReason: 'time_budget',
  hasMore: true, busy: false, status: 'partial', reviewUrl: '/data', ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
  const time = '2026-10-24T18:00:00.000Z';
  job = { id, status: 'queued', cancelRequested: false, pauseRequested: false, countsExact: true, passes: 0,
    totals: { ...EMPTY_JOB_TOTALS }, latestResult: null, maxJournalId: 1000, pauseReason: null, dispatchIssue: null,
    createdAt: time, updatedAt: time, finishedAt: null, leaseToken: null, leaseExpiresAt: null, passLimit: 200 };
  mocks.start.mockImplementation(async () => job);
  mocks.get.mockImplementation(async () => job);
  mocks.claim.mockImplementation(async (_id: string, token: string) => {
    job = { ...job, status: 'running', leaseToken: token, leaseExpiresAt: '2026-10-24T18:01:30.000Z' };
    return job;
  });
  mocks.beginPass.mockResolvedValue(true);
  mocks.finishPass.mockImplementation(async (_id: string, _token: string, _passId: string, next: CategorizationResult, status: string, reason: string | null) => {
    const totals = Object.fromEntries(Object.keys(EMPTY_JOB_TOTALS).map(key => [key, job.totals[key as keyof typeof EMPTY_JOB_TOTALS] + next[key as keyof typeof EMPTY_JOB_TOTALS]])) as typeof EMPTY_JOB_TOTALS;
    job = { ...job, passes: job.passes + 1, totals, latestResult: next,
      status: job.cancelRequested ? 'cancelled' : job.pauseRequested ? 'paused' : status === 'queued' ? 'running' : status as StoredCategorizationJob['status'], pauseReason: reason };
    return job;
  });
  mocks.release.mockImplementation(async () => {
    job = { ...job, status: job.status === 'running' ? 'queued' : job.status, leaseToken: null, leaseExpiresAt: null };
    return job;
  });
  mocks.failPass.mockImplementation(async () => { job = { ...job, status: 'paused', pauseReason: 'processing_failed', countsExact: false }; });
  mocks.counts.mockResolvedValue({ remaining: 1103, available: 764, needsReview: 339, scopeAvailable: 764 });
  mocks.process.mockResolvedValue(result({ hasMore: false, available: 0, scopeAvailable: 0, aiSkippedReason: null, deferredReason: null }));
});
afterEach(() => { vi.useRealTimers(); });

describe('automatic durable categorisation worker', () => {
  it('continues progressing passes in the same hop and finishes automatic work without claiming reviews are resolved', async () => {
    mocks.process.mockResolvedValueOnce(result()).mockResolvedValueOnce(result({ hasMore: false, available: 0, scopeAvailable: 0, aiSkippedReason: null, deferredReason: null }));
    mocks.counts.mockResolvedValue({ remaining: 339, available: 0, needsReview: 339, scopeAvailable: 0 });
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledTimes(2);
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ maxJournalId: 1000, limit: 100, source: 'scheduled' }));
    expect(run).toMatchObject({ shouldContinue: false, job: { status: 'completed', passes: 2, countsExact: true, totals: { aiCategorized: 64, reviewQueued: 46 }, counts: { needsReview: 339 } } });
    expect(run.job?.message).toContain('339 records still need review');
    expect(run.job).not.toHaveProperty('leaseToken');
    expect(run.job).not.toHaveProperty('passLimit');
  });
  it('hands off a progressing job when the hop has too little time for another normal model pass', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    mocks.process.mockImplementation(async () => {
      vi.setSystemTime(startedAt + 60_000);
      return result();
    });
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ deadlineMs: 45_000, modelTimeoutMs: 20_000 }));
    expect(run).toMatchObject({ shouldContinue: true, job: { status: 'queued', passes: 1, pauseReason: null, totals: { aiCategorized: 32 } } });
    expect(vi.getTimerCount()).toBe(0);
  });
  it('pauses on provider failure after saving acknowledged progress without retrying the same failing pass', async () => {
    mocks.process.mockResolvedValue(result({ deferredReason: 'model_failed', aiSkippedReason: 'AI batch failed.' }));
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ shouldContinue: false, job: { status: 'paused', pauseReason: 'model_failed', totals: { aiCategorized: 32 } } });
  });
  it('stops unchanged eligible queues instead of chaining empty time-budget passes', async () => {
    mocks.process.mockResolvedValue(result({ ruleBased: 0, aiCategorized: 0, reviewQueued: 0 }));
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(run.job).toMatchObject({ status: 'paused', pauseReason: 'no_progress' });
  });
  it('backs off when another processing lease owns the ledger', async () => {
    mocks.process.mockResolvedValue(result({ busy: true, total: 0, ruleBased: 0, aiCategorized: 0, reviewQueued: 0, deferredReason: 'busy' }));
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ shouldContinue: true, delayMs: 5000, job: { status: 'queued' } });
  });
  it('honours cancellation after an in-flight pass and retains that pass acknowledgement', async () => {
    mocks.process.mockImplementation(async () => { job.cancelRequested = true; return result(); });
    const run = await runCategorizationJob(id);
    expect(mocks.process).toHaveBeenCalledOnce();
    expect(run).toMatchObject({ shouldContinue: false, job: { status: 'cancelled', passes: 1, totals: { aiCategorized: 32 } } });
  });
  it('never invokes processing when another live worker owns the job', async () => {
    job.status = 'running';
    job.leaseToken = '09c05cae-f9e2-45a1-9cb9-c25c4e4f981c';
    mocks.claim.mockResolvedValue(null);
    await runCategorizationJob(id);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.release).not.toHaveBeenCalled();
  });
  it('marks pass outcome unknown after a processor failure instead of claiming zero changes', async () => {
    mocks.process.mockRejectedValue(new Error('private connection details'));
    const run = await runCategorizationJob(id);
    expect(run).toMatchObject({ shouldContinue: false, job: { status: 'paused', countsExact: false, pauseReason: 'processing_failed', passes: 0 } });
    expect(JSON.stringify(run)).not.toContain('private connection details');
  });
  it('keeps unavailable current coverage unknown and never autostarts a paused existing job', async () => {
    job.status = 'paused'; job.pauseReason = 'user_paused';
    mocks.counts.mockRejectedValue(new Error('private database detail'));
    expect(await startCategorizationJob()).toMatchObject({ id, status: 'paused', counts: null, countsObservedAt: null, scopeAvailable: null });
    expect(mocks.process).not.toHaveBeenCalled();
    expect((await getCategorizationJob())?.counts).toBeNull();
  });
  it('bounds a stalled database claim and does not start late financial work when that claim eventually resolves', async () => {
    vi.useFakeTimers();
    let resolveClaim!: (value: StoredCategorizationJob) => void;
    mocks.claim.mockImplementation((_id: string, token: string) => new Promise<StoredCategorizationJob>(resolve => {
      job = { ...job, status: 'running', leaseToken: token };
      resolveClaim = resolve;
    }));
    const pending = runCategorizationJob(id, { budgetMs: 1000 });
    const rejected = expect(pending).rejects.toThrow('exceeded its execution budget');
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
    resolveClaim(job);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.release).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
});
