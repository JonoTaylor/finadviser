import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getRequest, jsonRequest } from '../../__tests__/helpers';

const listRulesWithCategory = vi.fn();
const addRule = vi.fn();
const deleteRule = vi.fn();
const updateRule = vi.fn();

vi.mock('@/lib/repos', () => ({
  categoryRepo: {
    listRulesWithCategory: (...args: unknown[]) => listRulesWithCategory(...args),
    addRule: (...args: unknown[]) => addRule(...args),
    deleteRule: (...args: unknown[]) => deleteRule(...args),
    updateRule: (...args: unknown[]) => updateRule(...args),
  },
}));

const { GET, POST, DELETE, PATCH } = await import('./route');

describe('/api/categories/rules', () => {
  beforeEach(() => {
    [listRulesWithCategory, addRule, deleteRule, updateRule].forEach((m) => m.mockReset());
  });

  it('GET returns the list', async () => {
    listRulesWithCategory.mockResolvedValue([{ id: 1 }]);
    const res = await GET(getRequest('http://localhost/'), {});
    expect(await res.json()).toEqual([{ id: 1 }]);
  });

  it('POST accepts a safe regex pattern', async () => {
    addRule.mockResolvedValue({ id: 1 });
    const res = await POST(
      jsonRequest('http://localhost/', {
        pattern: '^tesco',
        categoryId: 3,
        matchType: 'regex',
      }),
      {},
    );
    expect(res.status).toBe(200);
    expect(addRule).toHaveBeenCalled();
  });

  it('POST rejects a nested-quantifier regex (ReDoS)', async () => {
    const res = await POST(
      jsonRequest('http://localhost/', {
        pattern: '(a+)+',
        categoryId: 3,
        matchType: 'regex',
      }),
      {},
    );
    expect(res.status).toBe(400);
    expect(addRule).not.toHaveBeenCalled();
  });

  it('POST accepts a contains pattern regardless of regex shape', async () => {
    addRule.mockResolvedValue({ id: 1 });
    const res = await POST(
      jsonRequest('http://localhost/', {
        pattern: '(a+)+',
        categoryId: 3,
        matchType: 'contains',
      }),
      {},
    );
    expect(res.status).toBe(200);
  });

  it('DELETE rejects without an id query param', async () => {
    const res = await DELETE(getRequest('http://localhost/'), {});
    expect(res.status).toBe(400);
  });

  it('DELETE removes the rule with a valid id', async () => {
    deleteRule.mockResolvedValue(undefined);
    const res = await DELETE(getRequest('http://localhost/?id=5'), {});
    expect(res.status).toBe(200);
    expect(deleteRule).toHaveBeenCalledWith(5);
  });

  it('PATCH rejects a dangerous regex update', async () => {
    const res = await PATCH(
      jsonRequest(
        'http://localhost/?id=5',
        { pattern: '(a*)*', matchType: 'regex' },
        'PATCH',
      ),
      {},
    );
    expect(res.status).toBe(400);
    expect(updateRule).not.toHaveBeenCalled();
  });
});
