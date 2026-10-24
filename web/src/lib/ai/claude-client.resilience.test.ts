import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider';
import type { ToolSet } from 'ai';

const mocks = vi.hoisted(() => ({ stream: vi.fn(), gateway: vi.fn(), resolve: vi.fn(), memory: vi.fn(), execute: vi.fn() }));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), streamText: mocks.stream }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }));
vi.mock('./model', () => ({ resolveModelId: mocks.resolve }));
vi.mock('@/lib/repos/ai-memory.repo', () => ({ aiMemoryRepo: { renderForPrompt: mocks.memory } }));
vi.mock('./tools', () => ({
  TOOL_DEFINITIONS: ['auto_categorize', 'get_data_intelligence', 'update_owner_tax_profile'].map(name => ({
    name, description: name, input_schema: { type: 'object', properties: {}, additionalProperties: false },
  })),
  TOOL_LABELS: {}, executeTool: mocks.execute,
}));
import { runAgent } from './claude-client';
import { classifyAdviserFailure } from './adviser-failure';

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
function response(parts: LanguageModelV2StreamPart[]) {
  return { stream: new ReadableStream<LanguageModelV2StreamPart>({ start(controller) {
    parts.forEach(part => controller.enqueue(part)); controller.close();
  } }) };
}
const text = (value: string) => response([
  { type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'answer' },
  { type: 'text-delta', id: 'answer', delta: value }, { type: 'text-end', id: 'answer' },
  { type: 'finish', finishReason: 'stop', usage },
]);
const call = (name: string, id: string) => response([
  { type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: id, toolName: name, input: '{}' },
  { type: 'finish', finishReason: 'tool-calls', usage },
]);
function scriptedModel(stream: (request: LanguageModelV2CallOptions) => ReturnType<typeof response>) {
  const model: LanguageModelV2 = {
    specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
    doGenerate: async () => { throw new Error('No specialist model should be required for an imperative action.'); },
    doStream: async request => stream(request),
  };
  mocks.gateway.mockReturnValue(model);
}
async function consume(options: Parameters<typeof runAgent>[2] = {}) {
  const events = [];
  for await (const event of runAgent('Categorise my transactions.', [], options)) events.push(event);
  return events;
}
beforeEach(async () => {
  vi.resetAllMocks();
  mocks.resolve.mockResolvedValue({ modelId: 'fixture' });
  mocks.memory.mockResolvedValue(null);
  mocks.stream.mockImplementation((await vi.importActual<typeof import('ai')>('ai')).streamText);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('adviser runtime recovery and action boundaries', () => {
  it('does not start a second long categorisation pass when it would consume the answer budget', async () => {
    vi.useFakeTimers();
    const startedAt = Date.now();
    const onToolStart = vi.fn();
    const calls: LanguageModelV2CallOptions[] = [];
    mocks.execute.mockImplementation(async () => {
      vi.setSystemTime(startedAt + 60_000);
      return { aiCategorized: 7, hasMore: true, available: 93 };
    });
    scriptedModel(request => {
      calls.push(request);
      if (calls.length <= 2) return call('auto_categorize', `pass-${calls.length}`);
      expect(request.toolChoice).toEqual({ type: 'none' });
      expect(request.tools ?? []).toHaveLength(0);
      expect(JSON.stringify(request.prompt)).toContain('"actionStarted":false');
      expect(JSON.stringify(request.prompt)).toContain('"aiCategorized":7');
      return text('Seven records were categorised. Continue the remaining processing in /data.');
    });
    const events = await consume({ onToolStart });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('auto_categorize', {});
    expect(onToolStart).toHaveBeenCalledExactlyOnceWith('auto_categorize');
    expect(events.at(-1)).toMatchObject({ type: 'text', content: expect.stringContaining('Seven records') });
    expect(calls).toHaveLength(3);
  });

  it('reserves the final SDK step for an answer instead of stopping on a tool call', async () => {
    let count = 0;
    mocks.execute.mockResolvedValue({ status: 'ready' });
    scriptedModel(request => {
      count++;
      if (count < 15) return call('get_data_intelligence', `read-${count}`);
      expect(request.toolChoice).toEqual({ type: 'none' });
      return text('This review is limited to the sources already read.');
    });
    const events = await consume();
    expect(count).toBe(15);
    expect(mocks.execute).toHaveBeenCalledTimes(14);
    expect(events.at(-1)).toMatchObject({ type: 'text', content: expect.stringContaining('limited') });
  });

  it('contains private source exceptions and lets the adviser disclose an unavailable read', async () => {
    mocks.execute.mockRejectedValue(new Error('private SQL containing bank reference and credentials'));
    let count = 0;
    scriptedModel(request => {
      if (++count === 1) return call('get_data_intelligence', 'failed-read');
      expect(JSON.stringify(request.prompt)).toContain('Its values remain unknown');
      expect(JSON.stringify(request.prompt)).not.toContain('private SQL');
      return text('This source is unavailable; its values remain unknown.');
    });
    expect((await consume()).at(-1)).toMatchObject({ type: 'text', content: expect.stringContaining('unavailable') });
  });

  it('blocks repeated writes after an adapter threw with an unverified outcome', async () => {
    mocks.execute.mockRejectedValue(new Error('private database failure after commit'));
    const onToolStart = vi.fn();
    let count = 0;
    scriptedModel(request => {
      count++;
      if (count < 3) return call('update_owner_tax_profile', `write-${count}`);
      expect(JSON.stringify(request.prompt)).toContain('unverified outcome');
      expect(JSON.stringify(request.prompt)).not.toContain('private database failure');
      return text('The action result could not be verified. Check the current record before retrying.');
    });
    await consume({ onToolStart });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('update_owner_tax_profile', {});
    expect(onToolStart).toHaveBeenCalledExactlyOnceWith('update_owner_tax_profile');
  });

  it.each([
    { status: 'unavailable', total: null, remaining: null, error: 'Some decisions may have been saved.' },
    { status: 'unknown' }, { outcome: 'unknown' }, { error: 'No successful save has been confirmed.' },
    { status: 'partial', applied: 1, unavailable: 1, results: [{ status: 'applied' }, { status: 'unavailable' }] },
  ])('blocks another write after an adapter returns an unverified result: %j', async result => {
    mocks.execute.mockResolvedValue(result);
    const onToolStart = vi.fn();
    let count = 0;
    scriptedModel(request => {
      count++;
      if (count < 3) return call('auto_categorize', `write-${count}`);
      expect(JSON.stringify(request.prompt)).toContain('unverified outcome');
      return text('Check the current records before retrying the unverified action.');
    });
    await consume({ onToolStart });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('auto_categorize', {});
    expect(onToolStart).toHaveBeenCalledExactlyOnceWith('auto_categorize');
  });

  it.each([
    { status: 'partial', aiCategorized: 7, remaining: 93, available: 93, hasMore: true, deferredReason: 'time_budget' },
    { status: 'complete', aiCategorized: 7, remaining: 0, available: 0, hasMore: false },
    { status: 'conflict', error: 'The current revision changed; no write was applied.' },
    { status: 'rejected', success: false, error: 'Invalid input.' },
  ])('allows another eligible action after an acknowledged or rejected result: %j', async result => {
    mocks.execute.mockResolvedValueOnce(result).mockResolvedValueOnce({ status: 'complete', aiCategorized: 2, remaining: 0 });
    const onToolStart = vi.fn();
    let count = 0;
    scriptedModel(() => ++count < 3 ? call('auto_categorize', `pass-${count}`) : text('The returned results are recorded.'));
    await consume({ onToolStart });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
    expect(onToolStart).toHaveBeenCalledTimes(2);
  });

  it('retains a provider failure cause for safe status classification without leaking its body', async () => {
    const providerError = Object.assign(new Error('private provider body'), { name: 'AI_APICallError', statusCode: 429 });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    scriptedModel(() => response([{ type: 'error', error: providerError }]));
    let failure: unknown;
    try { await consume(); } catch (error) { failure = error; }
    expect(classifyAdviserFailure(failure)).toMatchObject({ code: 'provider_rate_limit' });
    expect((failure as Error).message).not.toContain('private provider body');
    expect(consoleError).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('distinguishes the server deadline from an explicit cancellation even if the model stalls', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    mocks.gateway.mockReturnValue({ modelId: 'fixture' });
    mocks.stream.mockImplementation(() => {
      started();
      return { fullStream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) } };
    });
    const pending = consume().catch(error => error);
    await ready;
    await vi.advanceTimersByTimeAsync(110_000);
    expect(classifyAdviserFailure(await pending)).toMatchObject({ code: 'request_timeout' });
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(consume({ signal: cancelled.signal })).rejects.toMatchObject({ code: 'request_cancelled' });
  });

  it('does not report a tool as started when the user cancels before its execution', async () => {
    const controller = new AbortController();
    const onToolStart = vi.fn();
    mocks.gateway.mockReturnValue({ modelId: 'fixture' });
    mocks.stream.mockImplementation((request: { tools: ToolSet }) => ({ fullStream: (async function* () {
      controller.abort();
      await request.tools.update_owner_tax_profile.execute?.({}, { toolCallId: 'cancelled', messages: [] });
      yield { type: 'text-delta', text: 'Cancelled' };
    })() }));
    await expect(consume({ signal: controller.signal, onToolStart })).rejects.toMatchObject({ code: 'request_cancelled' });
    expect(onToolStart).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('uses the API absolute deadline after preparation instead of starting a fresh full budget', async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const deadlineAt = Date.now() + 15_000;
    mocks.gateway.mockReturnValue({ modelId: 'fixture' });
    mocks.stream.mockImplementation(() => {
      started();
      return { fullStream: { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) } };
    });
    const pending = consume({ deadlineAt }).catch(error => error);
    await ready;
    await vi.advanceTimersByTimeAsync(15_000);
    expect(classifyAdviserFailure(await pending)).toMatchObject({ code: 'request_timeout' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start a request whose API deadline already elapsed', async () => {
    await expect(consume({ deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ code: 'request_timeout' });
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.stream).not.toHaveBeenCalled();
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it.each([
    ['length', 'response_limit'], ['tool-calls', 'response_limit'],
    ['content-filter', 'provider_rejected'], ['error', 'invalid_response'], ['unknown', 'invalid_response'],
  ])('classifies finish reason %s as %s without inventing a time limit', async (finishReason, code) => {
    mocks.gateway.mockReturnValue({ modelId: 'fixture' });
    mocks.stream.mockImplementation(() => ({ fullStream: (async function* () {
      yield { type: 'text-delta', text: 'A partial answer' };
      yield { type: 'finish', finishReason };
    })() }));
    await expect(consume()).rejects.toMatchObject({ code });
  });
});
