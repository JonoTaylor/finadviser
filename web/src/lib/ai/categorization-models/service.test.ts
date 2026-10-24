import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModelEvaluationState, ModelEvaluationResult } from './types';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), catalog: vi.fn(), configured: vi.fn(), evaluate: vi.fn() }));
vi.mock('@/lib/finance-workspace/store', async original => ({ ...await original<typeof import('@/lib/finance-workspace/store')>(), readWorkspace: mocks.read, writeWorkspace: mocks.write }));
vi.mock('./catalog', () => ({
  gatewayEvaluationConfigured: mocks.configured, getEvaluationCatalog: mocks.catalog,
  defaultEvaluationCandidates: () => ['openai/gpt-4.1-mini', 'google/gemini-3-flash', 'anthropic/claude-haiku-4.5'],
}));
vi.mock('./runner', async original => ({ ...await original<typeof import('./runner')>(), evaluateCatalogModel: mocks.evaluate }));
import { WorkspaceConflictError } from '@/lib/finance-workspace/store';

let stored: { version: 1; revision: number; updatedAt: string | null; data: ModelEvaluationState };
const models = ['openai/gpt-4.1-mini', 'google/gemini-3-flash', 'anthropic/claude-haiku-4.5'].map(id => ({ id, name: id, inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }));
const qualified = (modelId: string): ModelEvaluationResult => ({ modelId, status: 'complete', qualified: true, correct: 10, total: 10,
  unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5, completedBatches: 2, totalBatches: 2,
  meanLatencyMs: 500, maxLatencyMs: 550, estimatedCostUsd: modelId.startsWith('google') ? 0.001 : 0.002 });
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks(); vi.stubEnv('CATEGORIZATION_MODEL_ID', '');
  stored = { version: 1, revision: 0, updatedAt: null, data: { running: null, lastReport: null, selection: null } };
  mocks.read.mockImplementation(async () => structuredClone(stored));
  mocks.write.mockImplementation(async (_key: string, _schema: unknown, data: ModelEvaluationState, revision: number) => {
    if (revision !== stored.revision) throw new WorkspaceConflictError();
    stored = { version: 1, revision: revision + 1, updatedAt: new Date().toISOString(), data: structuredClone(data) };
    return structuredClone(stored);
  });
  mocks.configured.mockReturnValue(true);
  mocks.catalog.mockResolvedValue({ status: 'available', observedAt: new Date().toISOString(), models });
  mocks.evaluate.mockImplementation(async (model: { id: string }) => qualified(model.id));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('persisted measured model policy', () => {
  it('selects a fully qualified measured winner, then skips repeat automatic spending for 24 hours', async () => {
    const service = await import('./service');
    expect(await service.maybeEvaluateCategorizationModels()).toMatchObject({ status: 'complete', report: { recommendedModelId: 'google/gemini-3-flash', applied: true } });
    expect(stored.revision).toBe(2);
    expect(stored.data.selection?.modelId).toBe('google/gemini-3-flash');
    expect(await service.resolveCategorizationModelId()).toEqual({ modelId: 'google/gemini-3-flash', source: 'qualified' });
    expect(await service.maybeEvaluateCategorizationModels()).toMatchObject({ status: 'skipped' });
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);
  });
  it('allows only one concurrent runner to buy model calls', async () => {
    const service = await import('./service');
    const results = await Promise.all([service.maybeEvaluateCategorizationModels(), service.maybeEvaluateCategorizationModels()]);
    expect(results.filter(result => result.status === 'complete')).toHaveLength(1);
    expect(mocks.evaluate).toHaveBeenCalledTimes(3);
  });
  it('keeps the existing default when no candidate qualifies rather than calling an unmeasured model best', async () => {
    mocks.evaluate.mockImplementation(async (model: { id: string }) => ({ ...qualified(model.id), qualified: false, correct: 9, unsafeAutoApplied: 1 }));
    const service = await import('./service');
    expect(await service.maybeEvaluateCategorizationModels()).toMatchObject({ status: 'complete', report: { recommendedModelId: null, applied: false } });
    expect(stored.data.selection).toBeNull();
    expect(await service.resolveCategorizationModelId()).toEqual({ modelId: 'openai/gpt-4.1-mini', source: 'default' });
  });
  it('honours an explicit deployment pin while retaining an honest measured recommendation', async () => {
    vi.stubEnv('CATEGORIZATION_MODEL_ID', 'anthropic/claude-haiku-4-5');
    const service = await import('./service');
    expect(await service.maybeEvaluateCategorizationModels()).toMatchObject({ report: { applied: false, recommendedModelId: 'google/gemini-3-flash' } });
    expect(await service.resolveCategorizationModelId()).toEqual({ modelId: 'anthropic/claude-haiku-4.5', source: 'env' });
  });
  it('does not call providers when the live catalogue is unavailable or inputs are outside it', async () => {
    mocks.catalog.mockResolvedValue({ status: 'unavailable', observedAt: new Date().toISOString(), models: [] });
    const service = await import('./service');
    expect(await service.maybeEvaluateCategorizationModels()).toMatchObject({ status: 'unavailable', report: { results: [], applied: false } });
    expect(mocks.evaluate).not.toHaveBeenCalled();
    mocks.catalog.mockResolvedValue({ status: 'available', observedAt: new Date().toISOString(), models });
    await expect(service.evaluateCategorizationModels({ force: true, modelIds: ['fixture/not-listed'] })).rejects.toThrow('currently listed');
    expect(mocks.evaluate).not.toHaveBeenCalled();
  });
  it('bounds a hung claim without starting late provider calls when it later resolves', async () => {
    vi.useFakeTimers();
    let acknowledge!: (value: typeof stored) => void;
    mocks.write.mockImplementation(() => new Promise(resolve => { acknowledge = resolve; }));
    const service = await import('./service');
    const pending = service.maybeEvaluateCategorizationModels({ budgetMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ status: 'unavailable', report: null });
    acknowledge({ ...stored, revision: 1 });
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.evaluate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
