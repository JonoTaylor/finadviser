import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), conversation: vi.fn(), history: vi.fn(), addUser: vi.fn(), addAssistant: vi.fn() }));
vi.mock('@/lib/ai/claude-client', () => ({ runAgent: mocks.run }));
vi.mock('@/lib/ai/conversation-manager', () => ({
  getOrCreateConversation: mocks.conversation, getHistory: mocks.history,
  addUserMessage: mocks.addUser, addAssistantMessage: mocks.addAssistant,
}));
import { POST } from './route';
import { NotFoundError } from '@/lib/errors';
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
  mocks.run.mockImplementation(async function* () {
    yield { type: 'specialist-start', specialistId: 'tax', label: 'Tax specialist' };
    yield { type: 'specialist-result', result: taxResult };
    yield { type: 'text', content: 'Confirm the year before estimating tax.' };
  });
});

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
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('Check any saved record changes');
    expect(stream.some(event => event.type === 'complete')).toBe(false);
  });

  it('never retries an ambiguous history save and never reports completion when it fails', async () => {
    mocks.addAssistant.mockRejectedValue(new Error('private write failure'));
    const text = await (await POST(request(body))).text();
    expect(mocks.addAssistant).toHaveBeenCalledTimes(1);
    expect(events(text).at(-1).type).toBe('error');
    expect(text).not.toContain('private write');
  });

  it('saves a durable warning if a record action was announced but the model failed before any answer text', async () => {
    mocks.run.mockImplementation(async function* () {
      yield { type: 'tool', name: 'update_owner_tax_profile', label: 'Saving tax profile' };
      throw new Error('Provider failed after the action started');
    });
    const stream = events(await (await POST(request(body))).text());
    expect(stream.at(-1).type).toBe('error');
    expect(mocks.addAssistant).toHaveBeenCalledTimes(1);
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('**Review interrupted.**');
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
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('interrupted');
    expect(mocks.addAssistant.mock.calls[0][2].status).toBe('interrupted');
    expect(mocks.addAssistant.mock.calls[0][1]).toContain('**Review interrupted.**');
  });

  it('rejects an unknown saved conversation before appending a new message', async () => {
    mocks.conversation.mockRejectedValue(new NotFoundError('Conversation not found'));
    expect((await POST(request({ ...body, conversationId: 999 }))).status).toBe(404);
    expect(mocks.addUser).not.toHaveBeenCalled();
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
