import { describe, it, expect, vi, beforeEach } from 'vitest';
import { jsonRequest, paramsCtx } from '../../__tests__/helpers';

const getEntry = vi.fn();
const getBookEntries = vi.fn();
const updateCategory = vi.fn();
const getRules = vi.fn();
const addRule = vi.fn();

vi.mock('@/lib/repos', () => ({
  journalRepo: {
    getEntry: (...args: unknown[]) => getEntry(...args),
    getBookEntries: (...args: unknown[]) => getBookEntries(...args),
    updateCategory: (...args: unknown[]) => updateCategory(...args),
  },
  categoryRepo: {
    getRules: (...args: unknown[]) => getRules(...args),
    addRule: (...args: unknown[]) => addRule(...args),
  },
}));

const { GET, PATCH } = await import('./route');

describe('GET /api/journal/[id]', () => {
  beforeEach(() => {
    [getEntry, getBookEntries].forEach((m) => m.mockReset());
  });

  it('returns 404 when the entry does not exist', async () => {
    getEntry.mockResolvedValue(null);
    const res = await GET(
      new Request('http://localhost/') as never,
      paramsCtx({ id: '42' }),
    );
    expect(res.status).toBe(404);
  });

  it('returns the entry with its book entries', async () => {
    getEntry.mockResolvedValue({ id: 42, description: 'x' });
    getBookEntries.mockResolvedValue([{ accountId: 1, amount: '10' }]);
    const res = await GET(
      new Request('http://localhost/') as never,
      paramsCtx({ id: '42' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      id: 42,
      description: 'x',
      bookEntries: [{ accountId: 1, amount: '10' }],
    });
  });

  it('rejects a non-numeric id param', async () => {
    const res = await GET(
      new Request('http://localhost/') as never,
      paramsCtx({ id: 'abc' }),
    );
    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/journal/[id]', () => {
  beforeEach(() => {
    [updateCategory, getRules, addRule].forEach((m) => m.mockReset());
    getRules.mockResolvedValue([]);
  });

  it('updates the category for a valid body', async () => {
    const res = await PATCH(
      jsonRequest('http://localhost/', { categoryId: 5 }, 'PATCH'),
      paramsCtx({ id: '10' }),
    );
    expect(res.status).toBe(200);
    expect(updateCategory).toHaveBeenCalledWith(10, 5);
  });

  it('creates a rule when createRule=true and the rule is new', async () => {
    await PATCH(
      jsonRequest(
        'http://localhost/',
        { categoryId: 5, createRule: true, description: 'Tesco' },
        'PATCH',
      ),
      paramsCtx({ id: '10' }),
    );
    expect(addRule).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: 'Tesco', categoryId: 5 }),
    );
  });

  it('does not create a duplicate rule', async () => {
    getRules.mockResolvedValue([
      { pattern: 'tesco', categoryId: 5, matchType: 'contains' },
    ]);
    await PATCH(
      jsonRequest(
        'http://localhost/',
        { categoryId: 5, createRule: true, description: 'Tesco' },
        'PATCH',
      ),
      paramsCtx({ id: '10' }),
    );
    expect(addRule).not.toHaveBeenCalled();
  });

  it('rejects a non-integer categoryId', async () => {
    const res = await PATCH(
      jsonRequest('http://localhost/', { categoryId: 'nope' }, 'PATCH'),
      paramsCtx({ id: '10' }),
    );
    expect(res.status).toBe(400);
    expect(updateCategory).not.toHaveBeenCalled();
  });
});
