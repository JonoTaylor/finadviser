import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/errors';

const tagJournalAsPropertyExpense = vi.hoisted(() => vi.fn());
vi.mock('@/lib/properties/property-expense-link', () => ({ tagJournalAsPropertyExpense }));

import { POST } from './route';

const post = (journalId: string, body: unknown) => POST(
  new Request(`http://localhost/api/properties/journal/${journalId}/tag`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  }),
  { params: Promise.resolve({ id: journalId }) },
);

beforeEach(() => {
  tagJournalAsPropertyExpense.mockReset();
  tagJournalAsPropertyExpense.mockResolvedValue({ journalId: 41, propertyId: 2, categoryId: 9 });
});

describe('POST /api/properties/journal/[id]/tag', () => {
  it('links the transaction to the chosen property without changing its category', async () => {
    const res = await post('41', { propertyId: 2 });
    expect(res.status).toBe(200);
    expect(tagJournalAsPropertyExpense).toHaveBeenCalledWith({ journalId: 41, propertyId: 2 });
    expect(await res.json()).toEqual({ ok: true, journalId: 41, propertyId: 2, categoryId: 9 });
  });

  it('reports a missing property or transaction as not found', async () => {
    tagJournalAsPropertyExpense.mockRejectedValueOnce(new NotFoundError('Property 2 not found'));
    const res = await post('41', { propertyId: 2 });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Property 2 not found');
  });

  it('rejects malformed requests before writing', async () => {
    for (const [id, body] of [['41', '{oops'], ['41', {}], ['41', { propertyId: 'two' }], ['abc', { propertyId: 2 }], ['41', []]] as const) {
      expect((await post(id, body)).status).toBe(400);
    }
    expect(tagJournalAsPropertyExpense).not.toHaveBeenCalled();
  });
});
