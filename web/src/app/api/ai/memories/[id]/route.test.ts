import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ update: vi.fn(), delete: vi.fn() }));
vi.mock('@/lib/repos', () => ({ aiMemoryRepo: mocks, AI_MEMORY_MAX_CONTENT_LENGTH: 4000 }));
import { PATCH } from './route';

function patch(body: unknown, id = '1') {
  return PATCH(new NextRequest('http://localhost/api/ai/memories/' + id, {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id }) });
}
describe('correcting a saved adviser detail', () => {
  beforeEach(() => { vi.resetAllMocks(); });
  it('requires the exact old content and rejects malformed IDs', async () => {
    expect((await patch({ content: 'New' })).status).toBe(400);
    expect((await patch({ content: 'New', expectedContent: 'Old' }, '1oops')).status).toBe(400);
    expect((await patch({ content: '  ', expectedContent: 'Old' })).status).toBe(400);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('preserves a newer correction and returns a conflict', async () => {
    mocks.update.mockResolvedValue(null);
    expect((await patch({ content: 'New', expectedContent: 'Old' })).status).toBe(409);
    expect(mocks.update).toHaveBeenCalledWith(1, 'New', 'Old');
  });
  it('returns only the persisted fact on success', async () => {
    mocks.update.mockResolvedValue({ id: 1, content: 'New', source: 'user' });
    const result = await patch({ content: ' New ', expectedContent: 'Old' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ id: 1, content: 'New' });
  });
});
