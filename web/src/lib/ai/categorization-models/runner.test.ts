import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), gateway: vi.fn() }));
vi.mock('ai', () => ({ generateText: mocks.generate }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }));
import { BENCHMARK_CASES } from './fixtures';
import { evaluateCatalogModel, recommendedEvaluationModel } from './runner';
import type { ModelEvaluationResult } from './types';

const model = { id: 'openai/gpt-4.1-mini', name: 'Fixture model', inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 };
function answer(batch: number, unsafe = false) {
  const cases = BENCHMARK_CASES.slice(batch * 5, batch * 5 + 5);
  return { text: JSON.stringify({ decisions: cases.map(testCase => ({
    journalId: testCase.candidate.id,
    categoryId: unsafe && testCase.expectedCategoryId === null ? 1 : testCase.expectedCategoryId,
    confidence: unsafe || testCase.expectedCategoryId !== null ? 0.99 : 0.4,
    reason: 'Based on the supplied fictional context.',
  })) }), usage: { inputTokens: 10, outputTokens: 20 } };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.gateway.mockReturnValue('fixture-model');
  mocks.generate.mockResolvedValueOnce(answer(0)).mockResolvedValueOnce(answer(1));
});
afterEach(() => vi.useRealTimers());

describe('measured categorisation comparison', () => {
  it('qualifies a correct safe model only after both five-entry calls finish and retains actual cost evidence', async () => {
    const result = await evaluateCatalogModel(model, new AbortController().signal);
    expect(result).toMatchObject({ status: 'complete', qualified: true, correct: 10, total: 10, unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5, completedBatches: 2 });
    expect(result.estimatedCostUsd).toBeCloseTo(0.000072);
    expect(mocks.generate).toHaveBeenCalledTimes(2);
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1800 });
    expect(JSON.stringify(mocks.generate.mock.calls)).not.toContain('Jono');
  });
  it('rejects unsafe confident guesses even when account-movement guards would block some of them', async () => {
    mocks.generate.mockReset().mockResolvedValueOnce(answer(0)).mockResolvedValueOnce(answer(1, true));
    const result = await evaluateCatalogModel(model, new AbortController().signal);
    expect(result).toMatchObject({ qualified: false, correct: 5, unsafeAutoApplied: 5 });
    expect(recommendedEvaluationModel([result])).toBeNull();
  });
  it('does not mistake malformed JSON or unknown review counts for a completed safe evaluation', async () => {
    mocks.generate.mockReset().mockResolvedValue({ text: 'Not JSON', usage: {} });
    expect(await evaluateCatalogModel(model, new AbortController().signal)).toMatchObject({ qualified: false, correct: 0, invalidBatches: 2, reviewCount: null, estimatedCostUsd: null });
  });
  it('stops after one stalled model call without retries or invented cost', async () => {
    vi.useFakeTimers();
    mocks.generate.mockReset().mockImplementation(() => new Promise(() => {}));
    const pending = evaluateCatalogModel(model, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(8000);
    expect(await pending).toMatchObject({ qualified: false, status: 'timed_out', completedBatches: 0, estimatedCostUsd: null, reviewCount: null });
    expect(mocks.generate).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ranks qualified candidates by measured cost then latency and rechecks the safety metrics', () => {
    const valid: ModelEvaluationResult = { modelId: model.id, status: 'complete', qualified: true, correct: 10, total: 10,
      unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5, completedBatches: 2, totalBatches: 2,
      meanLatencyMs: 500, maxLatencyMs: 600, estimatedCostUsd: 0.001 };
    expect(recommendedEvaluationModel([
      { ...valid, modelId: 'fixture/unsafe', estimatedCostUsd: 0, unsafeAutoApplied: 1 },
      { ...valid, modelId: 'fixture/slow', estimatedCostUsd: 0.0001, maxLatencyMs: 8001 },
      { ...valid, modelId: 'fixture/unknown-cost', estimatedCostUsd: null, meanLatencyMs: 1 },
      valid,
    ])).toBe(model.id);
  });
});
