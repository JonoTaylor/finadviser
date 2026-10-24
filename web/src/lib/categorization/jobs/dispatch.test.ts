import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ after: vi.fn(), record: vi.fn(), fetch: vi.fn() }));
vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('./service', () => ({ recordCategorizationDispatch: mocks.record }));
import { categorizationWorkerOrigin, dispatchCategorizationJob, getCategorizationBackgroundCapability, scheduleCategorizationJob, shouldWakeCategorizationJob } from './dispatch';
import { authenticatedCategorizationJobId, CATEGORIZATION_WORKER_PATH } from './worker-auth';
import type { CategorizationJob } from './types';

const jobId = 'd821a308-79c7-4d59-8bf1-f7c895d231a4';
const secret = 'synthetic-worker-only-secret-123456';
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('SESSION_SECRET', secret);
  vi.stubEnv('VERCEL_URL', 'fixture-immutable.vercel.app');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'fixture.vercel.app');
  vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response(null, { status: 202 }));
  mocks.record.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('durable worker handoff', () => {
  it('uses only configured platform origins and never accepts private or arbitrary fetch targets', () => {
    expect(categorizationWorkerOrigin()).toBe('https://fixture.vercel.app');
    expect(categorizationWorkerOrigin({ VERCEL_ENV: 'preview', VERCEL_URL: 'preview.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'main.vercel.app' })).toBe('https://preview.vercel.app');
    for (const value of ['http://fixture.vercel.app', 'https://127.0.0.1', 'https://evil.com', 'https://fixture.vercel.app.evil.com', 'https://user:password@fixture.vercel.app', 'https://fixture.vercel.app:8443', 'https://fixture.vercel.app/private', 'https://fixture.vercel.app?token=private']) {
      expect(categorizationWorkerOrigin({ VERCEL_URL: value })).toBeNull();
    }
  });
  it('awaits a signed 202 handoff, forwarding neither session cookies nor financial data', async () => {
    expect(await dispatchCategorizationJob(jobId)).toEqual({ accepted: true, reason: null });
    const [url, init] = mocks.fetch.mock.calls[0];
    expect(String(url)).toBe('https://fixture.vercel.app' + CATEGORIZATION_WORKER_PATH);
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error' });
    expect(init.headers).not.toHaveProperty('cookie');
    expect(init).not.toHaveProperty('body');
    expect(authenticatedCategorizationJobId(new Request(url, { method: 'POST', headers: init.headers }), secret)).toBe(jobId);
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(jobId, true, null);
  });
  it('does not mistake an OK HTML response, redirect or rejected request for an accepted worker', async () => {
    mocks.fetch.mockResolvedValue(new Response('private deployment protection details', { status: 200 }));
    expect(await dispatchCategorizationJob(jobId)).toEqual({ accepted: false, reason: 'rejected' });
    expect(JSON.stringify(mocks.record.mock.calls)).not.toContain('private deployment');
    expect(mocks.record).toHaveBeenCalledWith(jobId, false, expect.stringContaining('did not accept'));
  });
  it('enforces its deadline even when fetch ignores cancellation', async () => {
    vi.useFakeTimers();
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
    const pending = dispatchCategorizationJob(jobId);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ accepted: false, reason: 'network_unavailable' });
    expect(mocks.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('registers an awaited after callback instead of starting work inside the chat response', async () => {
    expect(scheduleCategorizationJob(jobId)).toEqual({ scheduled: true, reason: null });
    expect(mocks.fetch).not.toHaveBeenCalled();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    vi.stubEnv('SESSION_SECRET', '');
    expect(scheduleCategorizationJob(jobId)).toEqual({ scheduled: false, reason: 'not_configured' });
    expect(getCategorizationBackgroundCapability().backgroundAvailable).toBe(false);
  });
  it('recovers only queued or expired-running jobs and respects user/provider pauses', () => {
    const now = Date.parse('2026-10-24T18:00:00Z');
    const job = { status: 'queued', updatedAt: new Date(now - 20_000).toISOString(), cancelRequested: false, pauseRequested: false, leaseExpiresAt: null } as CategorizationJob;
    expect(shouldWakeCategorizationJob(job, now)).toBe(true);
    expect(shouldWakeCategorizationJob({ ...job, updatedAt: new Date(now).toISOString() }, now)).toBe(false);
    expect(shouldWakeCategorizationJob({ ...job, status: 'paused' }, now)).toBe(false);
    expect(shouldWakeCategorizationJob({ ...job, status: 'cancelled' }, now)).toBe(false);
    expect(shouldWakeCategorizationJob({ ...job, pauseRequested: true }, now)).toBe(false);
    expect(shouldWakeCategorizationJob({ ...job, status: 'running', leaseExpiresAt: new Date(now - 1).toISOString() }, now)).toBe(true);
    expect(shouldWakeCategorizationJob({ ...job, status: 'running', cancelRequested: true, leaseExpiresAt: new Date(now - 1).toISOString() }, now)).toBe(true);
    expect(shouldWakeCategorizationJob({ ...job, status: 'running', pauseRequested: true, leaseExpiresAt: new Date(now - 1).toISOString() }, now)).toBe(true);
    expect(shouldWakeCategorizationJob({ ...job, status: 'running', leaseExpiresAt: new Date(now + 30_000).toISOString() }, now)).toBe(false);
  });
  it('backs off failed handoffs across status polling instead of retrying every poll', () => {
    const now = Date.parse('2026-10-24T18:00:00Z');
    const job = { status: 'queued', updatedAt: new Date(now).toISOString(), cancelRequested: false,
      pauseRequested: false, dispatchIssue: 'The next worker could not be reached.', leaseExpiresAt: null } as CategorizationJob;
    for (const elapsed of [0, 5_000, 10_000, 20_000, 29_999]) expect(shouldWakeCategorizationJob(job, now + elapsed)).toBe(false);
    expect(shouldWakeCategorizationJob(job, now + 30_000)).toBe(true);
    // An acknowledged retry stamps its own attempt time; a second observer
    // cannot immediately turn the old failure into another new attempt.
    expect(shouldWakeCategorizationJob({ ...job, updatedAt: new Date(now + 30_000).toISOString() }, now + 35_000)).toBe(false);
    const stale = { ...job, status: 'running' as const, leaseExpiresAt: new Date(now - 1).toISOString(), cancelRequested: true };
    expect(shouldWakeCategorizationJob(stale, now + 5_000)).toBe(false);
    expect(shouldWakeCategorizationJob(stale, now + 30_000)).toBe(true);
  });
});
