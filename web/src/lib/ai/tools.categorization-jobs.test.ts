import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

const mocks = vi.hoisted(() => ({
  start: vi.fn(), get: vi.fn(), pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(),
  capability: vi.fn(), schedule: vi.fn(), process: vi.fn(),
}));
vi.mock('@/lib/categorization/jobs/service', () => ({
  startCategorizationJob: mocks.start, getCategorizationJob: mocks.get,
  pauseCategorizationJob: mocks.pause, resumeCategorizationJob: mocks.resume, cancelCategorizationJob: mocks.cancel,
}));
vi.mock('@/lib/categorization/jobs/dispatch', () => ({
  getCategorizationBackgroundCapability: mocks.capability, scheduleCategorizationJob: mocks.schedule,
}));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
vi.mock('@/lib/repos', () => ({
  accountRepo: {}, journalRepo: {}, categoryRepo: {}, propertyRepo: {}, tipRepo: {},
  budgetRepo: {}, savingsGoalRepo: {}, aiMemoryRepo: {}, ownerTaxRepo: {},
}));
import { executeTool, TOOL_DEFINITIONS } from './tools';

const jobId = '39173a6b-538b-4c91-aadc-d32b61ded310';
const job = (overrides: Partial<CategorizationJob> = {}): CategorizationJob => ({
  id: jobId, status: 'queued', cancelRequested: false, pauseRequested: false, countsExact: true, passes: 0,
  totals: { total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, reviewQueued: 0, conflicts: 0, batches: 0 },
  latestResult: null, counts: { remaining: 500, needsReview: 100, available: 400 },
  countsObservedAt: '2026-10-24T18:00:00.000Z', scopeAvailable: 400, maxJournalId: 1000,
  pauseReason: null, dispatchIssue: null, message: null, createdAt: '2026-10-24T18:00:00.000Z',
  updatedAt: '2026-10-24T18:00:00.000Z', finishedAt: null, leaseExpiresAt: null, ...overrides,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.start.mockResolvedValue(job());
  mocks.get.mockResolvedValue(job());
  mocks.resume.mockResolvedValue(job());
  mocks.pause.mockResolvedValue(job({ status: 'running', pauseRequested: true }));
  mocks.cancel.mockResolvedValue(job({ status: 'running', cancelRequested: true }));
  mocks.capability.mockReturnValue({ backgroundAvailable: true, issue: null });
  mocks.schedule.mockReturnValue({ scheduled: true, reason: null });
});

describe('saved categorisation job adviser tools', () => {
  it('saves and schedules a job without running a long processing pass in the chat request', async () => {
    const result = await executeTool('start_categorization_job', {});
    expect(result).toMatchObject({ job: job(), scheduled: true, backgroundAvailable: true, processingUrl: '/data' });
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(mocks.process).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain('not proof a worker started');
    expect(JSON.stringify(result)).toContain('Progress totals belong only to this saved job');
  });
  it('does not automatically resume or reschedule an existing paused job', async () => {
    mocks.start.mockResolvedValue(job({ status: 'paused', pauseReason: 'model_failed' }));
    expect(await executeTool('start_categorization_job', {})).toMatchObject({ job: { status: 'paused', pauseReason: 'model_failed' }, scheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it('reuses a running job without another inline pass or duplicate dispatch', async () => {
    mocks.start.mockResolvedValue(job({ status: 'running' }));
    expect(await executeTool('start_categorization_job', {})).toMatchObject({ job: { status: 'running' }, scheduled: false });
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('reads current saved progress without starting, controlling or waking work', async () => {
    expect(await executeTool('get_categorization_job', { job_id: jobId })).toMatchObject({ job: job(), scheduled: false });
    expect(mocks.get).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
  it('preserves missing jobs and unavailable count coverage rather than inventing zero progress', async () => {
    mocks.get.mockResolvedValueOnce(null).mockResolvedValueOnce(job({ counts: null, countsExact: false, countsObservedAt: null }));
    expect(await executeTool('get_categorization_job', {})).toMatchObject({ job: null, scheduled: false });
    expect(await executeTool('get_categorization_job', {})).toMatchObject({ job: { counts: null, countsExact: false } });
    expect(mocks.get).toHaveBeenNthCalledWith(1, undefined);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('schedules continuation only after an explicitly requested resume returns a queued job', async () => {
    expect(await executeTool('control_categorization_job', { job_id: jobId, action: 'resume' })).toMatchObject({ job: { status: 'queued' }, scheduled: true });
    expect(mocks.resume).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(mocks.schedule).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each(['pause', 'cancel'] as const)('reports an in-flight %s request without falsely claiming that saved work has stopped', async action => {
    const result = await executeTool('control_categorization_job', { job_id: jobId, action });
    expect(result).toMatchObject({ job: { status: 'running', [action === 'pause' ? 'pauseRequested' : 'cancelRequested']: true }, scheduled: false });
    expect(mocks[action]).toHaveBeenCalledExactlyOnceWith(jobId);
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('keeps a saved job visible when automatic continuation is not configured', async () => {
    mocks.capability.mockReturnValue({ backgroundAvailable: false, issue: 'Automatic continuation is not configured.' });
    mocks.schedule.mockReturnValue({ scheduled: false, reason: 'not_configured' });
    expect(await executeTool('start_categorization_job', {})).toMatchObject({ job: { status: 'queued' }, backgroundAvailable: false, scheduled: false, issue: 'Automatic continuation is not configured.' });
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it.each([
    ['start_categorization_job', { journal_ids: [42] }], ['start_categorization_job', { limit: 100 }],
    ['get_categorization_job', { job_id: 'invalid' }], ['get_categorization_job', { job_id: jobId, resume: true }],
    ['control_categorization_job', { job_id: jobId, action: 'restart' }],
    ['control_categorization_job', { action: 'resume' }],
  ])('rejects malformed or scope-broadening input for %s before any job operation', async (name, input) => {
    expect(await executeTool(name as string, input as Record<string, unknown>)).toMatchObject({ status: 'rejected' });
    for (const mock of [mocks.start, mocks.get, mocks.pause, mocks.resume, mocks.cancel, mocks.schedule]) expect(mock).not.toHaveBeenCalled();
  });
  it('does not retry or expose private details after an unverified job save', async () => {
    mocks.start.mockRejectedValue(new Error('postgres://private-finance secret-token'));
    const result = await executeTool('start_categorization_job', {});
    expect(result).toMatchObject({ status: 'unavailable', job: null });
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.schedule).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain('private-finance');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
  it('does not schedule hidden work if the saved job status cannot be acknowledged safely', async () => {
    mocks.start.mockResolvedValue({ ...job(), createdAt: 'not-a-valid-timestamp' });
    expect(await executeTool('start_categorization_job', {})).toMatchObject({ status: 'unavailable', job: null });
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('registers strict job inputs rather than accepting arbitrary processing instructions', () => {
    for (const name of ['start_categorization_job', 'get_categorization_job', 'control_categorization_job']) {
      expect(TOOL_DEFINITIONS.find(tool => tool.name === name)?.input_schema.additionalProperties).toBe(false);
    }
  });
});
