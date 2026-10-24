import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

const mocks = vi.hoisted(() => ({
  get: vi.fn(), start: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), run: vi.fn(),
  capability: vi.fn(), schedule: vi.fn(), wake: vi.fn(), dispatch: vi.fn(), after: vi.fn(),
}));
vi.mock('@/lib/categorization/jobs/service', () => ({
  getCategorizationJob: mocks.get, startCategorizationJob: mocks.start, pauseCategorizationJob: mocks.pause,
  resumeCategorizationJob: mocks.resume, cancelCategorizationJob: mocks.cancel, runCategorizationJob: mocks.run,
}));
vi.mock('@/lib/categorization/jobs/dispatch', () => ({
  getCategorizationBackgroundCapability: mocks.capability, scheduleCategorizationJob: mocks.schedule,
  shouldWakeCategorizationJob: mocks.wake, dispatchCategorizationJob: mocks.dispatch,
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
import { GET, POST } from './route';
import { GET as getById, POST as control } from './[id]/route';
import { POST as worker } from './worker/route';
import { CATEGORIZATION_WORKER_PATH, createCategorizationWorkerHeaders } from '@/lib/categorization/jobs/worker-auth';

const id = 'd821a308-79c7-4d59-8bf1-f7c895d231a4';
const secret = 'synthetic-worker-only-secret-123456';
const job: CategorizationJob = {
  id, status: 'queued', cancelRequested: false, pauseRequested: false, countsExact: true, passes: 0,
  totals: { total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, reviewQueued: 0, conflicts: 0, batches: 0 },
  latestResult: null, counts: { remaining: 100, needsReview: 10, available: 90 }, countsObservedAt: '2026-10-24T18:00:00.000Z',
  scopeAvailable: 90, maxJournalId: 1000, pauseReason: null, dispatchIssue: null, message: null,
  createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:00:00.000Z', finishedAt: null, leaseExpiresAt: null,
};
const request = (body: unknown) => new Request('https://fixture.vercel.app/api/categorization/jobs', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
});
const context = (jobId = id) => ({ params: Promise.resolve({ id: jobId }) });
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SESSION_SECRET', secret);
  mocks.get.mockResolvedValue(job);
  mocks.start.mockResolvedValue(job);
  mocks.pause.mockResolvedValue({ ...job, status: 'paused', pauseReason: 'user_paused' });
  mocks.resume.mockResolvedValue(job);
  mocks.cancel.mockResolvedValue({ ...job, status: 'cancelled' });
  mocks.capability.mockReturnValue({ backgroundAvailable: true, issue: null });
  mocks.schedule.mockReturnValue({ scheduled: true, reason: null });
  mocks.wake.mockReturnValue(false);
  mocks.run.mockResolvedValue({ job, shouldContinue: true, delayMs: 0 });
  mocks.dispatch.mockResolvedValue({ accepted: true, reason: null });
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('saved categorisation jobs API', () => {
  it('starts/deduplicates a durable job and schedules work after the response without claiming it ran', async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(202);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toMatchObject({ job: { id, status: 'queued', passes: 0 }, backgroundAvailable: true });
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(id);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('returns a previous paused job without silently resuming it on another start click', async () => {
    mocks.start.mockResolvedValue({ ...job, status: 'paused', pauseReason: 'model_failed' });
    expect(await (await POST(request({}))).json()).toMatchObject({ job: { status: 'paused' } });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it('does not schedule financial processing behind an unreadable progress response', async () => {
    mocks.start.mockResolvedValue({ ...job, createdAt: 'not-a-timestamp' });
    expect((await POST(request({}))).status).toBe(503);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it.each(['{bad', null, [], { force: true }, { journalIds: [1] }, { limit: 10000 }])('rejects invalid scope/options before creating a job: %j', async input => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it('returns the latest terminal job too and wakes only core-eligible saved work', async () => {
    mocks.get.mockResolvedValue({ ...job, status: 'completed', finishedAt: job.updatedAt });
    expect(await (await GET()).json()).toMatchObject({ job: { status: 'completed' } });
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.get.mockResolvedValue(job); mocks.wake.mockReturnValue(true);
    expect((await GET()).status).toBe(200);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('exposes a real handoff issue without presenting configured access as running work', async () => {
    mocks.get.mockResolvedValue({ ...job, dispatchIssue: 'The background worker did not accept its handoff.' });
    expect(await (await GET()).json()).toMatchObject({ job: { status: 'queued' }, backgroundAvailable: true, issue: 'The background worker did not accept its handoff.' });
  });
  it('validates control IDs/actions and invokes pause, resume and cancel exactly once', async () => {
    expect((await control(request({ action: 'resume' }), context('not-a-job'))).status).toBe(400);
    expect((await control(request({ action: 'delete' }), context())).status).toBe(400);
    for (const action of ['pause', 'resume', 'cancel']) {
      expect((await control(request({ action }), context())).status).toBe(200);
    }
    expect(mocks.pause).toHaveBeenCalledExactlyOnceWith(id);
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(id);
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith(id);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('reads selected jobs and does not leak storage exceptions', async () => {
    expect((await getById(request({}), context())).status).toBe(200);
    expect(mocks.get).toHaveBeenCalledWith(id);
    mocks.get.mockResolvedValue(null);
    expect((await getById(request({}), context())).status).toBe(404);
    mocks.start.mockRejectedValue(new Error('Private ledger entry and credential'));
    const response = await POST(request({}));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('Private');
  });
});

describe('internal categorisation worker endpoint', () => {
  const signedRequest = () => new Request('https://fixture.vercel.app' + CATEGORIZATION_WORKER_PATH, {
    method: 'POST', headers: createCategorizationWorkerHeaders(id, secret),
  });
  it('does not start processing for missing credentials, forged headers or a missing secret', async () => {
    expect((await worker(new Request('https://fixture.vercel.app' + CATEGORIZATION_WORKER_PATH, { method: 'POST' }))).status).toBe(401);
    vi.stubEnv('SESSION_SECRET', '');
    expect((await worker(signedRequest())).status).toBe(503);
    expect(mocks.after).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('acknowledges only a valid handoff and awaits the bounded slice plus its next handoff in after', async () => {
    const response = await worker(signedRequest());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true });
    expect(mocks.run).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.run).toHaveBeenCalledExactlyOnceWith(id, { budgetMs: 75_000 });
    expect(mocks.dispatch).toHaveBeenCalledExactlyOnceWith(id);
  });
  it('does not chain completed/paused jobs or replay a slice whose outcome is unknown', async () => {
    mocks.run.mockResolvedValue({ job: { ...job, status: 'paused' }, shouldContinue: false, delayMs: 0 });
    await worker(signedRequest()); await mocks.after.mock.calls[0][0]();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.run.mockRejectedValue(new Error('Private database error and financial result'));
    await worker(signedRequest()); await mocks.after.mock.calls[1][0]();
    expect(mocks.dispatch).not.toHaveBeenCalled();
    expect(JSON.stringify(warning.mock.calls)).not.toContain('Private');
  });
});
