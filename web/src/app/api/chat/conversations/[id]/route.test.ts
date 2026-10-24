import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getConversationById: vi.fn(), getMessages: vi.fn() }));
vi.mock('@/lib/repos', () => ({ conversationRepo: mocks }));
import { GET } from './route';
const get = (id = '2') => GET(new NextRequest('http://localhost/api/chat/conversations/' + id), { params: Promise.resolve({ id }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConversationById.mockResolvedValue({ id: 2 });
});
describe('saved specialist conversation history API', () => {
  it('returns legacy null metadata and server-saved reviews without caching', async () => {
    const messages = [{ role: 'assistant', content: 'Legacy', metadata: null },
      { role: 'assistant', content: 'Current', metadata: { version: 1, specialistMode: 'tax', specialistResults: [], status: 'complete' } }];
    mocks.getMessages.mockResolvedValue(messages);
    const response = await get();
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    expect(await response.json()).toEqual(messages);
  });
  it('rejects malformed and unknown conversation IDs without pretending history is empty', async () => {
    expect((await get('2oops')).status).toBe(400);
    expect(mocks.getMessages).not.toHaveBeenCalled();
    mocks.getConversationById.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect(mocks.getMessages).not.toHaveBeenCalled();
  });
  it('reports a source failure as unavailable rather than an empty conversation', async () => {
    mocks.getMessages.mockRejectedValue(new Error('private database failure'));
    const response = await get();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private database');
  });
});
