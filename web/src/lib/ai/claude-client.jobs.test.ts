import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), gateway: vi.fn(), resolve: vi.fn(), memory: vi.fn(), stream: vi.fn() }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }));
vi.mock('./model', () => ({ resolveModelId: mocks.resolve }));
vi.mock('@/lib/repos/ai-memory.repo', () => ({ aiMemoryRepo: { renderForPrompt: mocks.memory } }));
vi.mock('./tools', () => ({
  TOOL_DEFINITIONS: [{ name: 'start_categorization_job', description: 'Start saved processing', input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false } }],
  TOOL_LABELS: {}, executeTool: mocks.execute,
}));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), streamText: mocks.stream }));
import { runAgent } from './claude-client';

const job: CategorizationJob = {
  id: '6344f29f-8726-4b08-8cd8-4c10be613c56', status: 'queued', cancelRequested: false, pauseRequested: false,
  countsExact: true, passes: 1, totals: { total: 56, ruleBased: 1, aiCategorized: 32, learned: 0, reviewQueued: 23, conflicts: 0, batches: 8 },
  latestResult: null, counts: { remaining: 1103, available: 764, needsReview: 339 }, countsObservedAt: '2026-10-24T18:05:00.000Z',
  scopeAvailable: 764, maxJournalId: 2000, pauseReason: null, dispatchIssue: null, message: null,
  createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:05:00.000Z', finishedAt: null, leaseExpiresAt: null,
};
const payload = (value: CategorizationJob = job) => ({ job: value, scheduled: true, backgroundAvailable: true, issue: null });
const consume = async (message: string, history: { role: 'user' | 'assistant'; content: string }[] = []) => {
  const events = [];
  for await (const event of runAgent(message, history)) events.push(event);
  return events;
};
beforeEach(() => { vi.resetAllMocks(); mocks.execute.mockResolvedValue(payload()); });

describe('routine categorisation starts saved processing directly', () => {
  it('starts once without resolving a model or launching specialist reviews and uses exact acknowledged counts', async () => {
    const events = await consume('Categorise my spending again.');
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('start_categorization_job', {});
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.gateway).not.toHaveBeenCalled();
    expect(mocks.memory).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(events.map(event => event.type)).toEqual(['tool', 'text']);
    const text = events.filter(event => event.type === 'text').map(event => event.content).join('');
    expect(text).toContain('33 categorised and 23 queued for review');
    expect(text).toContain('764 eligible for automatic processing and 339 awaiting review');
    expect(text).toContain('acknowledged passes');
    expect(text).not.toContain('~');
  });
  it('resumes an existing paused job only for a fresh explicit continuation command', async () => {
    mocks.execute.mockResolvedValueOnce(payload({ ...job, status: 'paused', pauseReason: 'model_failed' })).mockResolvedValueOnce(payload());
    await consume('Keep processing.', [{ role: 'user', content: 'Categorise all my transactions.' }]);
    expect(mocks.execute.mock.calls).toEqual([
      ['start_categorization_job', {}], ['control_categorization_job', { job_id: job.id, action: 'resume' }],
    ]);
  });
  it('keeps a paused job paused when starting alone does not explicitly resume it', async () => {
    mocks.execute.mockResolvedValue(payload({ ...job, status: 'paused', pauseReason: 'model_failed' }));
    const events = await consume('Categorise my transactions.');
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).toContain('processing job is paused');
    expect(JSON.stringify(events)).not.toContain('queued for a background worker');
  });
  it('reports an unconfirmed job without retrying a potentially completed start', async () => {
    mocks.execute.mockResolvedValue({ status: 'unavailable', job: null, error: 'Private diagnostics must not be echoed.' });
    const events = await consume('Categorise my transactions.');
    expect(mocks.execute).toHaveBeenCalledOnce();
    expect(JSON.stringify(events)).toContain('could not confirm');
    expect(JSON.stringify(events)).not.toContain('Private diagnostics');
  });
  it('does not claim a queued worker was scheduled when continuation is unavailable', async () => {
    mocks.execute.mockResolvedValue({ ...payload(), scheduled: false, backgroundAvailable: false });
    const events = await consume('Categorise my transactions.');
    expect(JSON.stringify(events)).toContain('background continuation could not be scheduled');
    expect(JSON.stringify(events)).not.toContain('You do not need to ask for each batch');
  });
});
