import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

const mocks = vi.hoisted(() => ({ get: vi.fn(), record: vi.fn(), after: vi.fn(), fetch: vi.fn() }));
vi.mock('@/lib/categorization/jobs/service', () => ({
  getCategorizationJob: mocks.get, startCategorizationJob: vi.fn(), recordCategorizationDispatch: mocks.record,
}));
vi.mock('next/server', async original => ({ ...await original<typeof import('next/server')>(), after: mocks.after }));
import { GET } from './route';

const now = Date.parse('2026-10-24T18:00:00Z');
const job = (): CategorizationJob => ({
  id: 'd821a308-79c7-4d59-8bf1-f7c895d231a4', status: 'queued', cancelRequested: false, pauseRequested: false,
  countsExact: true, passes: 0, totals: { total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, reviewQueued: 0, conflicts: 0, batches: 0 },
  latestResult: null, counts: null, countsObservedAt: null, scopeAvailable: null, maxJournalId: 1000,
  pauseReason: null, dispatchIssue: 'The next worker could not be reached.', message: null,
  createdAt: new Date(now - 60_000).toISOString(), updatedAt: new Date(now - 31_000).toISOString(),
  finishedAt: null, leaseExpiresAt: null,
});
beforeEach(() => {
  vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now);
  vi.stubEnv('SESSION_SECRET', 'synthetic-worker-only-secret-123456');
  vi.stubEnv('VERCEL_URL', 'fixture.vercel.app'); vi.stubEnv('VERCEL_ENV', 'production');
  vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'fixture.vercel.app');
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.fetch.mockResolvedValue(new Response('Deployment protection', { status: 403 }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('status polling after a rejected worker handoff', () => {
  it.each(['queued', 'running'] as const)('keeps a %s job visible while repeated GETs respect the persisted failure backoff', async status => {
    const saved = job();
    saved.status = status;
    saved.leaseExpiresAt = status === 'running' ? new Date(now - 1).toISOString() : null;
    mocks.get.mockImplementation(async () => ({ ...saved }));
    mocks.record.mockImplementation(async (_id: string, _accepted: boolean, issue: string | null) => {
      saved.dispatchIssue = issue;
      saved.updatedAt = new Date().toISOString();
    });
    expect((await GET()).status).toBe(200);
    expect(mocks.after).toHaveBeenCalledOnce();
    await mocks.after.mock.calls[0][0]();
    expect(mocks.fetch).toHaveBeenCalledOnce();
    for (const elapsed of [5000, 10_000, 15_000, 20_000, 29_999]) {
      vi.setSystemTime(now + elapsed);
      const response = await GET();
      expect(await response.json()).toMatchObject({ job: { status }, issue: expect.stringContaining('did not accept') });
      expect(mocks.after).toHaveBeenCalledOnce();
    }
    vi.setSystemTime(now + 30_000);
    await GET();
    expect(mocks.after).toHaveBeenCalledTimes(2);
    // Scheduling remains separate from execution: polling never reruns the
    // categoriser or claims that a rejected worker processed any records.
    expect(mocks.fetch).toHaveBeenCalledOnce();
  });
});
