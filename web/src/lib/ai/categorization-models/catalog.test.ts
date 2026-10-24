import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ catalog: vi.fn() }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: { getAvailableModels: mocks.catalog } }));
beforeEach(() => { vi.resetModules(); vi.resetAllMocks(); });
afterEach(() => vi.useRealTimers());

describe('live Gateway comparison catalogue', () => {
  it('uses actual language-model membership and per-token prices without inventing availability', async () => {
    mocks.catalog.mockResolvedValue({ models: [
      { id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 mini', modelType: 'language', pricing: { input: '0.0000004', output: '0.0000016' } },
      { id: 'google/gemini-3-flash', name: 'Gemini Flash', modelType: 'language' },
      { id: 'fixture/embedding', name: 'Embedding', modelType: 'embedding' },
      { id: 'not valid', name: 'Invalid ID' },
    ] });
    const { getEvaluationCatalog, defaultEvaluationCandidates } = await import('./catalog');
    const catalog = await getEvaluationCatalog();
    expect(catalog.status).toBe('available');
    expect(catalog.models).toEqual([
      { id: 'openai/gpt-4.1-mini', name: 'GPT 4.1 mini', inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 },
      { id: 'google/gemini-3-flash', name: 'Gemini Flash', inputUsdPerMillion: null, outputUsdPerMillion: null },
    ]);
    expect(defaultEvaluationCandidates(catalog)).toEqual(['openai/gpt-4.1-mini', 'google/gemini-3-flash']);
    await getEvaluationCatalog();
    expect(mocks.catalog).toHaveBeenCalledOnce();
  });
  it('reports unavailable metadata instead of using the adviser dropdown fallback as benchmark evidence', async () => {
    mocks.catalog.mockRejectedValue(new Error('private provider diagnostics'));
    const catalog = await (await import('./catalog')).getEvaluationCatalog();
    expect(catalog).toMatchObject({ status: 'unavailable', models: [] });
    expect(JSON.stringify(catalog)).not.toContain('private');
  });
  it('bounds a metadata provider that ignores cancellation', async () => {
    vi.useFakeTimers();
    mocks.catalog.mockImplementation(() => new Promise(() => {}));
    const { getEvaluationCatalog } = await import('./catalog');
    const pending = getEvaluationCatalog({ timeoutMs: 30 });
    await vi.advanceTimersByTimeAsync(30);
    expect(await pending).toMatchObject({ status: 'unavailable', models: [] });
    expect(vi.getTimerCount()).toBe(0);
  });
});
