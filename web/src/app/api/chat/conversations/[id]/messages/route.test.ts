import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getConversationById: vi.fn(), addMessage: vi.fn() }));
vi.mock('@/lib/repos', () => ({ conversationRepo: mocks }));
import { POST } from './route';
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/chat/conversations/2/messages', {
  method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
}), { params: Promise.resolve({ id: '2' }) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConversationById.mockResolvedValue({ id: 2 });
});
describe('legacy message endpoint', () => {
  it('does not accept browser-supplied specialist evidence', async () => {
    expect((await post({ role: 'assistant', content: 'Fabricated review', metadata: { version: 1 } })).status).toBe(400);
    expect(mocks.addMessage).not.toHaveBeenCalled();
  });
  it('preserves ordinary legacy message writes with no specialist claims', async () => {
    mocks.addMessage.mockResolvedValue({ id: 3, role: 'user', content: 'Question', metadata: null });
    expect((await post({ role: 'user', content: 'Question' })).status).toBe(201);
    expect(mocks.addMessage).toHaveBeenCalledExactlyOnceWith(2, 'user', 'Question');
  });
  it('rejects missing conversations and invalid roles before writing', async () => {
    expect((await post({ role: 'other', content: 'Question' })).status).toBe(400);
    mocks.getConversationById.mockResolvedValue(null);
    expect((await post({ role: 'user', content: 'Question' })).status).toBe(404);
    expect(mocks.addMessage).not.toHaveBeenCalled();
  });
});
