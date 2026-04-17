import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequest } from '../__tests__/helpers';

const listEntries = vi.fn();
const countEntries = vi.fn();

vi.mock('@/lib/repos', () => ({
  journalRepo: {
    listEntries: (...args: unknown[]) => listEntries(...args),
    countEntries: (...args: unknown[]) => countEntries(...args),
  },
}));

const { GET } = await import('./route');

describe('GET /api/journal', () => {
  beforeEach(() => {
    listEntries.mockReset();
    countEntries.mockReset();
    listEntries.mockResolvedValue([{ id: 1 }]);
    countEntries.mockResolvedValue(1);
  });

  it('returns entries + total for a valid request', async () => {
    const res = await GET(getRequest('http://localhost/api/journal'), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [{ id: 1 }], total: 1 });
    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 100, offset: 0 }),
    );
  });

  it('passes through validated filters', async () => {
    await GET(
      getRequest(
        'http://localhost/api/journal?startDate=2026-01-01&categoryId=3&limit=25',
      ),
      {},
    );
    expect(listEntries).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: '2026-01-01',
        categoryId: 3,
        limit: 25,
      }),
    );
  });

  it('rejects a malformed date', async () => {
    const res = await GET(getRequest('http://localhost/api/journal?startDate=2026/01/01'), {});
    expect(res.status).toBe(400);
    expect(listEntries).not.toHaveBeenCalled();
  });

  it('rejects a limit over the cap', async () => {
    const res = await GET(getRequest('http://localhost/api/journal?limit=10000'), {});
    expect(res.status).toBe(400);
  });

  it('rejects a non-numeric categoryId', async () => {
    const res = await GET(getRequest('http://localhost/api/journal?categoryId=abc'), {});
    expect(res.status).toBe(400);
  });
});
