import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ evaluate: vi.fn(), snapshot: vi.fn() }));
vi.mock('@/lib/ai/categorization-models/service', async original => ({
  ...await original<typeof import('@/lib/ai/categorization-models/service')>(),
  evaluateCategorizationModels: mocks.evaluate, getCategorizationModelsSnapshot: mocks.snapshot,
}));
import { GET, POST } from './route';
import { WorkspaceConflictError } from '@/lib/finance-workspace/store';
import { ModelEvaluationInputError } from '@/lib/ai/categorization-models/service';

const request = (body: unknown) => new Request('https://app.test/api/settings/categorization-models', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.evaluate.mockResolvedValue({ status: 'complete', report: {} });
  mocks.snapshot.mockResolvedValue({ revision: 2, gatewayConfigured: true, lastReport: { status: 'complete' } });
});

describe('categorisation model comparison API', () => {
  it('returns private/no-store settings without starting paid model inference on a read', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it('compares only explicitly selected live-catalogue candidates and a current settings revision', async () => {
    const response = await POST(request({ expectedRevision: 1, modelIds: ['openai/gpt-4.1-mini'], applyRecommendation: true }));
    expect(response.status).toBe(200);
    expect(mocks.evaluate).toHaveBeenCalledExactlyOnceWith({ expectedRevision: 1, modelIds: ['openai/gpt-4.1-mini'], applyRecommendation: true, force: true, signal: expect.any(AbortSignal) });
  });
  it.each([
    {}, { expectedRevision: -1 }, { expectedRevision: 0, transactions: [{ description: 'Private bank memo' }] },
    { expectedRevision: 0, modelIds: ['openai/gpt-4.1-mini', 'openai/gpt-4.1-mini'] },
    { expectedRevision: 0, modelIds: ['a/a', 'b/b', 'c/c', 'd/d'] },
  ])('rejects malformed input or private custom benchmark data before any provider call: %j', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it('does not retry a comparison when a claim is already running or its revision changed', async () => {
    mocks.evaluate.mockResolvedValueOnce({ status: 'running', report: null });
    expect((await POST(request({ expectedRevision: 1 }))).status).toBe(409);
    mocks.evaluate.mockRejectedValueOnce(new WorkspaceConflictError());
    expect((await POST(request({ expectedRevision: 1 }))).status).toBe(409);
    expect(mocks.evaluate).toHaveBeenCalledTimes(2);
  });
  it('rejects IDs absent from the actual Gateway catalogue and hides private provider errors', async () => {
    mocks.evaluate.mockRejectedValueOnce(new ModelEvaluationInputError());
    expect((await POST(request({ expectedRevision: 1 }))).status).toBe(400);
    mocks.evaluate.mockRejectedValueOnce(new Error('Private key and provider prompt body'));
    const response = await POST(request({ expectedRevision: 1 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('Private key');
  });
  it('does not acknowledge an unconfirmed paid attempt with a previous successful report', async () => {
    mocks.evaluate.mockResolvedValue({ status: 'unavailable', report: null });
    mocks.snapshot.mockResolvedValue({ revision: 2, lastReport: { id: 'old-success', status: 'complete' } });
    const response = await POST(request({ expectedRevision: 2 }));
    expect(response.status).toBe(503);
    expect(await response.text()).toContain('could not be confirmed');
    expect(mocks.snapshot).not.toHaveBeenCalled();
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });
  it('can show a newly persisted unavailable report as an acknowledged outcome', async () => {
    const report = { id: 'new-unavailable', status: 'unavailable', results: [] };
    mocks.evaluate.mockResolvedValue({ status: 'unavailable', report });
    mocks.snapshot.mockResolvedValue({ revision: 3, lastReport: report });
    const response = await POST(request({ expectedRevision: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 3, lastReport: report });
    expect(mocks.evaluate).toHaveBeenCalledOnce();
  });
});
