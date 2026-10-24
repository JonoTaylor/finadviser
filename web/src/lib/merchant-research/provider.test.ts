import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ generateText: vi.fn(), gateway: vi.fn(), search: vi.fn() }));
vi.mock('ai', () => ({ generateText: mocks.generateText, stepCountIs: vi.fn(() => 'one-step') }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: Object.assign(mocks.gateway, { tools: { perplexitySearch: mocks.search } }) }));
import { lookupMerchant } from './provider';

const input = { merchantName: 'Example Cafe', privateNames: ['Jono Taylor'] };
const nativeResult = (output: unknown, overrides: Record<string, unknown> = {}) => ({
  text: 'Untrusted model narrative is not a source.',
  toolResults: [{ toolName: 'merchant_search', providerExecuted: true, input: { query: 'Example Cafe business merchant' }, output, ...overrides }],
});
const source = { title: 'Example Cafe', url: 'https://www.tesco.com/cafe/#menu', snippet: 'Cafe serving coffee and food.' };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AI_GATEWAY_API_KEY', 'test-gateway-key');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('VERCEL_OIDC_TOKEN', '');
  vi.stubEnv('MERCHANT_RESEARCH_ENABLED', 'true');
  vi.stubEnv('MERCHANT_RESEARCH_MODEL_ID', '');
  vi.stubEnv('CATEGORIZATION_MODEL_ID', '');
  mocks.gateway.mockReturnValue('fast-model');
  mocks.search.mockReturnValue('native-search-tool');
  mocks.generateText.mockResolvedValue(nativeResult({ results: [source] }));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('bounded native merchant web research', () => {
  it('uses the native search results with actual source URLs and keeps all private input local', async () => {
    const result = await lookupMerchant(input);
    expect(result).toMatchObject({ status: 'matched', scope: 'merchant_identity_only', sources: [{ ...source, url: 'https://www.tesco.com/cafe/' }] });
    expect(result.sources[0].retrievedAt).toBe(result.researchedAt);
    const request = mocks.generateText.mock.calls[0][0];
    expect(request).toMatchObject({ tools: { merchant_search: 'native-search-tool' }, toolChoice: { type: 'tool', toolName: 'merchant_search' }, stopWhen: 'one-step', maxRetries: 0 });
    expect(request.prompt).toBe(JSON.stringify({ public_query: 'Example Cafe business merchant' }));
    expect(JSON.stringify(request)).not.toContain('Jono Taylor');
    expect(mocks.gateway).toHaveBeenCalledWith('openai/gpt-4.1-mini');
  });
  it('uses a dedicated configured categorisation model rather than a chat setting', async () => {
    vi.stubEnv('CATEGORIZATION_MODEL_ID', 'openai/gpt-4.1');
    await lookupMerchant(input);
    expect(mocks.gateway).toHaveBeenCalledWith('openai/gpt-4.1');
  });
  it('makes no network/model call for private identity data or unavailable credentials', async () => {
    expect(await lookupMerchant({ merchantName: 'Jono Taylor', privateNames: ['Jono Taylor'] })).toMatchObject({ status: 'skipped_private', query: null });
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it('never accepts model prose or non-native tool output as search evidence', async () => {
    mocks.generateText.mockResolvedValue({ text: JSON.stringify({ results: [source] }), toolResults: [] });
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
    mocks.generateText.mockResolvedValue(nativeResult({ results: [source] }, { providerExecuted: false }));
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
  });
  it('rejects mismatched queries and unsafe citations rather than reporting no matches', async () => {
    mocks.generateText.mockResolvedValue(nativeResult({ results: [source] }, { input: { query: 'some different person' } }));
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable' });
    mocks.generateText.mockResolvedValue(nativeResult({ results: [{ ...source, url: 'https://127.0.0.1' }] }));
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
  });
  it('bounds snippets and source count and removes duplicate citations', async () => {
    mocks.generateText.mockResolvedValue(nativeResult({ results: [source, source, ...[1, 2, 3, 4].map(id => ({ ...source, url: `https://www.tesco.com/${id}`, title: 'x'.repeat(500), snippet: '<p>' + 'y'.repeat(3000) + '</p>' }))] }));
    const result = await lookupMerchant(input);
    expect(result.sources).toHaveLength(3);
    expect(result.sources[1].title).toHaveLength(200);
    expect(result.sources[1].snippet).toHaveLength(1200);
  });
  it.each([
    [{ results: [] }, 'no_matches'], [{ error: 'timeout', message: 'private provider detail' }, 'timed_out'],
    [{ error: 'rate_limit', message: 'private provider detail' }, 'unavailable'],
  ])('distinguishes provider result %j as %s', async (output, status) => {
    mocks.generateText.mockResolvedValue(nativeResult(output));
    const result = await lookupMerchant(input);
    expect(result).toMatchObject({ status, sources: [] });
    expect(JSON.stringify(result)).not.toContain('private provider detail');
  });
  it('enforces the deadline when a provider ignores cancellation', async () => {
    vi.useFakeTimers();
    mocks.generateText.mockImplementation(() => new Promise(() => {}));
    const pending = lookupMerchant(input, { timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    expect(await pending).toMatchObject({ status: 'timed_out', sources: [] });
    expect(mocks.generateText.mock.calls[0][0].abortSignal.aborted).toBe(true);
  });
  it('does not start research after the caller cancels', async () => {
    expect(await lookupMerchant(input, { signal: AbortSignal.abort() })).toMatchObject({ status: 'timed_out' });
    expect(mocks.generateText).not.toHaveBeenCalled();
  });
  it('does not expose exception messages or make automatic retry requests', async () => {
    mocks.generateText.mockRejectedValue(new Error('secret provider body token=private'));
    expect(await lookupMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
    expect(mocks.generateText).toHaveBeenCalledOnce();
  });
});
