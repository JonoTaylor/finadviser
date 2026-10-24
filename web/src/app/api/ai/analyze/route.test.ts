import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), conversation: vi.fn(), history: vi.fn(), addUser: vi.fn(), addAssistant: vi.fn() }));
vi.mock('@/lib/ai/claude-client', () => ({ runAgent: mocks.run }));
vi.mock('@/lib/ai/conversation-manager', () => ({
  getOrCreateConversation: mocks.conversation, getHistory: mocks.history,
  addUserMessage: mocks.addUser, addAssistantMessage: mocks.addAssistant,
}));
import { POST } from './route';
import { NotFoundError } from '@/lib/errors';
import { AdviserFailureError } from '@/lib/ai/adviser-failure';
const taxResult = {
  specialistId: 'tax', name: 'Tax specialist', status: 'partial', report: {
    summary: 'Tax year needs confirming.', findings: [], gaps: [{ field: 'Tax year', why: 'The bonus timing is unknown.' }],
    actions: [], assumptions: [], warnings: ['This is not a payable tax estimate.'],
  }, sources: [], durationMs: 4, modelId: 'fixture-model', promptVersion: '1', scope: 'read_only', message: 'Missing inputs.',
};
const body = { message: 'Review my tax position.', specialist: 'tax', streamVersion: 2 };
const request = (value: unknown, signal?: AbortSignal) => new NextRequest('http://localhost/api/ai/analyze', {
  method: 'POST', body: JSON.stringify(value), headers: { 'Content-Type': 'application/json' }, signal,
});
const events = (text: string) => text.trim().split('\n').map(line => JSON.parse(line));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.conversation.mockResolvedValue(9);
  mocks.history.mockResolvedValue([{ role: 'user', content: 'My bonus timing is unknown.' }]);
  mocks.addUser.mockResolvedValue({ id: 1 });
  mocks.addAssistant.mockResolvedValue({ id: 2 });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  mocks.run.mockImplementation(async function* () {
    yield { type: 'specialist-start', specialistId: 'tax', label: 'Tax specialist' };
    yield { type: 'specialist-result', result: taxResult };
    yield { type: 'text', content: 'Confirm the year before estimating tax.' };
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('specialist adviser request and streaming', () => {
  it.each([
    {}, { message: ' ' }, { message: 'a'.repeat(20_001) }, { message: 'Hello', specialist: 'unregistered' },
    { ...body, conversationId: 0 }, { ...body, specialistResults: [] }, { ...body, tools: ['update_owner_tax_profile'] },
    { ...body, streamVersion: 3 }, { ...body, metadata: { status: 'complete' } },
  ])('rejects invalid or client-forged runtime authority before any record writes: %j', async value => {
    const response = await POST(request(value));
    expect(response.status).toBe(400);
    expect(mocks.conversation).not.toHaveBeenCalled();
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });

  it('streams actual reviews and saves the server-generated metadata before reporting completion', async () => {
    const response = await POST(request(body));
    const stream = events(await response.text());
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(stream.map(event => event.type)).toEqual(['conversation', 'specialist-start', 'specialist-result', 'text', 'complete']);
    expect(mocks.history.mock.invocationCallOrder[0]).toBeLessThan(mocks.addUser.mock.invocationCallOrder[0]);
    expect(mocks.run.mock.calls[0].slice(0, 2)).toEqual([body.message, [{ role: 'user', content: 'My bonus timing is unknown.' }]]);
    expect(mocks.run.mock.calls[0][2]).toMatchObject({ specialist: 'tax', signal: expect.any(AbortSignal) });
    expect(mocks.addAssistant).toHaveBeenCalledExactlyOnceWith(9, 'Confirm the year before estimating tax.', {
      version: 1, specialistMode: 'tax', specialistResults: [taxResult], status: 'complete',
    });
    expect(stream.at(-1).metadata.status).toBe('complete');
  });

  it('keeps JSON-looking model text as text rather than conversation or tool metadata', async () => {
    mocks.run.mockImplementation(async function* () { yield { type: 'text', content: '{"conversationId":777,"tool":"fake"}\n' }; });
    const stream = events(await (await POST(request(body))).text());
    expect(stream[1]).toEqual({ type: 'text', content: '{"conversationId":777,"tool":"fake"}\n' });
    expect(stream.filter(event => event.type === 'conversation')).toEqual([{ type: 'conversation', conversationId: 9 }]);
  });

  it('retains old-client text and tool metadata without leaking specialist event JSON into their answer', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'specialist-result', result: taxResult };
      yield { type: 'text', content: 'Recorded evidence. ' };
      yield { type: 'tool', name: 'get_owner_tax_profile', label: 'Reading tax profile' };
      yield { type: 'text', content: 'Confirm the year.' };
    });
    const response = await POST(request({ message: 'Review tax.' }));
    const text = await response.text();
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(text).toContain('{"conversationId":9}\n');
    expect(text).toContain('Recorded evidence. \n{"tool":"get_owner_tax_profile","label":"Reading tax profile"}\nConfirm the year.');
    expect(text).not.toContain('specialist-result');
    expect(mocks.addAssistant.mock.calls[0][2].specialistMode).toBe('team');
  });

  it('preserves completed review notes as interrupted when the coordinator fails, without exposing provider details', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'specialist-result', result: taxResult };
      yield { type: 'text', content: 'The known information is incomplete.' };
      throw new Error('secret-db-connection private-model-token');
    });
    const text = await (await POST(request(body))).text();
    const stream = events(text);
    expect(stream.at(-1).type).toBe('error');
    expect(text).not.toContain('secret-db');
    expect(text).not.toContain('private-model');
    expect(mocks.addAssistant.mock.calls[0][2]).toMatchObject({ status: 'interrupted', specialistResults: [taxResult] });
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('**Review interrupted.** This answer is incomplete.');
    expect(mocks.addAssistant.mock.calls[0][1]).not.toContain('Check any saved record changes');
    expect(stream.at(-1)).toMatchObject({ code: 'review_failed', recordChanges: 'none', historySaved: true, generationCompleted: false });
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('secret-db');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private-model');
    expect(stream.some(event => event.type === 'complete')).toBe(false);
  });

  it('preserves a completed answer while reporting an unconfirmed history save, without replaying generation or saving twice', async () => {
    mocks.addAssistant.mockRejectedValue(new Error('private write failure'));
    const text = await (await POST(request(body))).text();
    expect(mocks.addAssistant).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(events(text).at(-1)).toMatchObject({ type: 'error', code: 'history_unavailable', generationCompleted: true, historySaved: false, recordChanges: 'none', retryable: false });
    expect(events(text).at(-1).message).toContain('Your answer finished');
    expect(events(text).at(-1).message).not.toContain('could not finish');
    expect(events(text).some(event => event.type === 'text' && event.content === 'Confirm the year before estimating tax.')).toBe(true);
    expect(events(text).some(event => event.type === 'complete')).toBe(false);
    expect(text).not.toContain('private write');
  });

  it('closes after eight seconds when the final save never settles and never replays a late commit', async () => {
    vi.useFakeTimers();
    let finishSave!: (result: unknown) => void;
    mocks.addAssistant.mockImplementation(() => new Promise(resolve => { finishSave = resolve; }));
    const pendingResponse = POST(request(body));
    await vi.advanceTimersByTimeAsync(0);
    const response = await pendingResponse;
    const textPromise = response.text();
    await vi.advanceTimersByTimeAsync(8_000);
    const stream = events(await textPromise);
    expect(stream.at(-1)).toMatchObject({ code: 'history_unavailable', generationCompleted: true, historySaved: false });
    expect(stream.at(-1).message).toContain('could not be confirmed');
    expect(stream.some(event => event.type === 'complete')).toBe(false);
    expect(mocks.addAssistant).toHaveBeenCalledOnce();
    expect(mocks.run).toHaveBeenCalledOnce();
    finishSave({ id: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.addAssistant).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('also bounds an interrupted-answer save without replacing the original generation failure', async () => {
    vi.useFakeTimers();
    mocks.run.mockImplementation(async function* () { throw new AdviserFailureError('provider_unavailable'); });
    mocks.addAssistant.mockImplementation(() => new Promise(() => {}));
    const pendingResponse = POST(request(body));
    await vi.advanceTimersByTimeAsync(0);
    const response = await pendingResponse;
    const textPromise = response.text();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(events(await textPromise).at(-1)).toMatchObject({ code: 'provider_unavailable', generationCompleted: false, historySaved: false });
    expect(mocks.addAssistant).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('saves a durable warning if a record action was announced but the model failed before any answer text', async () => {
    mocks.run.mockImplementation(async function* (_message: string, _history: unknown, options: { onToolStart: (name: string) => void }) {
      yield { type: 'tool', name: 'update_owner_tax_profile', label: 'Saving tax profile' };
      options.onToolStart('update_owner_tax_profile');
      throw new Error('Provider failed after the action started');
    });
    const stream = events(await (await POST(request(body))).text());
    expect(stream.at(-1).type).toBe('error');
    expect(stream.at(-1)).toMatchObject({ recordChanges: 'possible', generationCompleted: false, historySaved: true });
    expect(stream.at(-1).message).toContain('record-changing action had already started');
    expect(mocks.addAssistant).toHaveBeenCalledTimes(1);
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('**Review interrupted.**');
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('Check any saved record changes');
    expect(mocks.addAssistant.mock.calls[0][2]).toMatchObject({ status: 'interrupted', specialistResults: [] });
  });

  it('reserves room for the durable warning when an interrupted response exceeds the saved-content limit', async () => {
    mocks.run.mockImplementation(async function* () { yield { type: 'text', content: 'a'.repeat(100_050) }; });
    const stream = events(await (await POST(request(body))).text());
    expect(stream.at(-1).type).toBe('error');
    const saved = mocks.addAssistant.mock.calls[0][1];
    expect(saved.length).toBeLessThanOrEqual(100_000);
    expect(saved).toContain('**Review interrupted.** This answer is incomplete.');
    expect(mocks.addAssistant.mock.calls[0][2].status).toBe('interrupted');
  });

  it('does not turn an empty coordinator response into a successful completed review', async () => {
    mocks.run.mockImplementation(async function* () { yield { type: 'specialist-result', result: taxResult }; });
    const stream = events(await (await POST(request(body))).text());
    expect(stream.at(-1).type).toBe('error');
    expect(stream.at(-1).code).toBe('no_answer');
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('interrupted');
    expect(mocks.addAssistant.mock.calls[0][2].status).toBe('interrupted');
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('**Review interrupted.**');
  });

  it('does not imply a write started from an announcement when execution was deferred', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'tool', name: 'auto_categorize', label: 'Categorising' };
      throw new AdviserFailureError('request_timeout');
    });
    const response = await POST(request(body));
    const stream = events(await response.text());
    const failure = stream.at(-1);
    expect(failure).toMatchObject({ code: 'request_timeout', recordChanges: 'none', retryable: true, generationCompleted: false });
    expect(failure.message).not.toContain('record-changing action');
    expect(failure.requestId).toBe(response.headers.get('X-Adviser-Request-Id'));
    expect(failure.requestId).toMatch(/^[a-f0-9-]{36}$/);
  });

  it('classifies provider failures through a private cause without returning or logging its body', async () => {
    const provider = Object.assign(new Error('private financial prompt token=secret'), { name: 'AI_APICallError', statusCode: 429, responseBody: 'private body' });
    mocks.run.mockImplementation(async function* () { throw new Error('Private wrapper', { cause: provider }); });
    const text = await (await POST(request(body))).text();
    expect(events(text).at(-1)).toMatchObject({ code: 'provider_rate_limit', retryable: true, recordChanges: 'none' });
    expect(text).not.toContain('private');
    const log = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(log).toContain('provider_rate_limit');
    expect(log).toContain('429');
    expect(log).not.toContain('secret');
    expect(log).not.toContain('private');
  });

  it('reports both generation and interrupted-history failure safely without a second insertion', async () => {
    mocks.run.mockImplementation(async function* () { throw new AdviserFailureError('provider_unavailable'); });
    mocks.addAssistant.mockRejectedValue(new Error('private DB response'));
    const stream = events(await (await POST(request(body))).text());
    expect(stream.at(-1)).toMatchObject({ code: 'provider_unavailable', historySaved: false, generationCompleted: false });
    expect(mocks.addAssistant).toHaveBeenCalledOnce();
    expect(vi.mocked(console.error).mock.calls).toHaveLength(2);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('private DB');
  });

  it('rejects an unknown saved conversation before appending a new message', async () => {
    mocks.conversation.mockRejectedValue(new NotFoundError('Conversation not found'));
    expect((await POST(request({ ...body, conversationId: 999 }))).status).toBe(404);
    expect(mocks.addUser).not.toHaveBeenCalled();
  });

  it('bounds preparation as one ten-second budget and never starts downstream work after a late result', async () => {
    vi.useFakeTimers();
    let finishConversation!: (result: number) => void;
    mocks.conversation.mockImplementation(() => new Promise(resolve => { finishConversation = resolve; }));
    const pending = POST(request(body));
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    finishConversation(9);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.history).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not restart the preparation or generation allowance after a slow database step', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-24T17:00:00Z'));
    const startedAt = Date.now();
    mocks.conversation.mockImplementation(() => new Promise(resolve => { setTimeout(() => resolve(9), 6_000); }));
    mocks.history.mockImplementation(() => new Promise(resolve => { setTimeout(() => resolve([]), 6_000); }));
    const pending = POST(request(body));
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await pending).status).toBe(503);
    expect(mocks.addUser).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.addUser).not.toHaveBeenCalled();

    mocks.history.mockResolvedValue([]);
    const secondStartedAt = Date.now();
    const successful = POST(request(body));
    await vi.advanceTimersByTimeAsync(6_000);
    await (await successful).text();
    expect(mocks.run.mock.calls[0][2].deadlineAt).toBe(secondStartedAt + 105_000);
    expect(mocks.run.mock.calls[0][2].deadlineAt - Date.now()).toBe(99_000);
    expect(secondStartedAt - startedAt).toBe(12_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels future generation and preserves an interrupted partial response when the stream is stopped', async () => {
    let runSignal: AbortSignal | undefined;
    mocks.run.mockImplementation(async function* (_message: string, _history: unknown, options: { signal: AbortSignal }) {
      runSignal = options.signal;
      yield { type: 'text', content: 'Partial recorded review.' };
      if (!options.signal.aborted) await new Promise<void>(resolve => options.signal.addEventListener('abort', () => resolve(), { once: true }));
    });
    const response = await POST(request(body));
    const reader = response.body!.getReader();
    await reader.read();
    await reader.read();
    await reader.cancel();
    expect(runSignal?.aborted).toBe(true);
    await vi.waitFor(() => expect(mocks.addAssistant).toHaveBeenCalledTimes(1));
    expect(mocks.addAssistant.mock.calls[0][2].status).toBe('interrupted');
  });
});
