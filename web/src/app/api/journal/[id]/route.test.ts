import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), entry: vi.fn(), legs: vi.fn() }));
vi.mock('@/lib/repos', () => ({ journalRepo: { getEntry: mocks.entry, getBookEntries: mocks.legs } }));
vi.mock('@/lib/categorization/review', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/categorization/review')>();
  return { ...actual, getCategorizationRecords: mocks.read, confirmedCategorize: mocks.save };
});
import { GET, PATCH } from './route';
import { CategorizationConflictError, InvalidCategorizationError } from '@/lib/categorization/review';

const snapshot = 'a'.repeat(32);
const patch = (body: unknown, id = '5') => PATCH(new NextRequest('http://localhost/api/journal/' + id, { method: 'PATCH', body: JSON.stringify(body) }), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue([{ journalId: 5, snapshot }]);
  mocks.save.mockResolvedValue({ journalId: 5, categoryId: 4, remembered: false });
});

describe('explicit category choices', () => {
  it('supports existing clients without making a broad description rule', async () => {
    const response = await patch({ categoryId: 4, createRule: true, description: 'untrusted replacement text' });
    expect(response.status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ journalId: 5, categoryId: 4, snapshot, remember: true });
  });
  it('uses the supplied evidence snapshot when a client reviewed it', async () => {
    await patch({ categoryId: 4, expectedSnapshot: 'b'.repeat(32) });
    expect(mocks.save).toHaveBeenCalledWith({ journalId: 5, categoryId: 4, snapshot: 'b'.repeat(32), remember: false });
  });
  it.each([{ categoryId: 0 }, { categoryId: '4' }, { categoryId: 4, createRule: 'true' }, { categoryId: 4, expectedSnapshot: 'stale' }, { categoryId: 4, propertyId: 2 }, {}])('rejects invalid category payload %j without reads or writes', async body => {
    expect((await patch(body)).status).toBe(400);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it.each(['NaN', '2.5', '0', '-1', '2147483648'])('rejects invalid transaction ID %s', async id => {
    expect((await patch({ categoryId: 4 }, id)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('returns not found without creating a saved choice', async () => {
    mocks.read.mockResolvedValue([]);
    expect((await patch({ categoryId: 4 })).status).toBe(404);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('reports conflicts so an editor can retain its choice', async () => {
    mocks.save.mockRejectedValue(new CategorizationConflictError());
    expect((await patch({ categoryId: 4 })).status).toBe(409);
  });
  it('rejects categories that disappeared', async () => {
    mocks.save.mockRejectedValue(new InvalidCategorizationError('Category unavailable.'));
    expect((await patch({ categoryId: 4 })).status).toBe(422);
  });
  it('does not expose provider errors or claim an unconfirmed save succeeded', async () => {
    mocks.save.mockRejectedValue(new Error('provider-secret-url'));
    const response = await patch({ categoryId: 4 });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('provider-secret-url');
  });
  it('returns current evidence with an existing transaction read', async () => {
    mocks.entry.mockResolvedValue({ id: 5, categoryId: null });
    mocks.legs.mockResolvedValue([{ accountId: 2, amount: '-10.00' }]);
    const response = await GET(new NextRequest('http://localhost/api/journal/5'), { params: Promise.resolve({ id: '5' }) });
    expect(await response.json()).toMatchObject({ id: 5, snapshot, bookEntries: [{ accountId: 2, amount: '-10.00' }] });
  });
});
