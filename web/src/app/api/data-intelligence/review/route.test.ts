import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loadReviewQueue: vi.fn(), decideReview: vi.fn() }));
vi.mock('@/lib/categorization/review', async () => {
  const real = await vi.importActual<typeof import('@/lib/categorization/review')>('@/lib/categorization/review');
  return { ...real, loadReviewQueue: mocks.loadReviewQueue, decideReview: mocks.decideReview };
});
import { CategorizationConflictError, InvalidCategorizationError } from '@/lib/categorization/review';
import { GET, POST } from './route';

const snapshot = 'a'.repeat(32);
const post = (body: unknown) => new NextRequest('http://localhost/api/data-intelligence/review', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
beforeEach(() => vi.resetAllMocks());

describe('data assistant review API', () => {
  it('loads bounded defaults and preserves an actually empty available queue', async () => {
    mocks.loadReviewQueue.mockResolvedValue({ items: [], total: 0, nextCursor: null, categories: [] });
    const response = await GET(new NextRequest('http://localhost/api/data-intelligence/review'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.loadReviewQueue).toHaveBeenCalledWith(25, 0);
    expect(await response.json()).toEqual({ items: [], total: 0, nextCursor: null, categories: [] });
  });

  it('uses only valid page sizes and cursors', async () => {
    mocks.loadReviewQueue.mockResolvedValue({ items: [{ journalId: 9 }], total: 26, nextCursor: 9, categories: [] });
    const response = await GET(new NextRequest('http://localhost/api/data-intelligence/review?limit=10&afterId=7'));
    expect(response.status).toBe(200);
    expect(mocks.loadReviewQueue).toHaveBeenCalledWith(10, 7);
    expect(await response.json()).toMatchObject({ total: 26, nextCursor: 9 });
    for (const query of ['limit=0', 'limit=51', 'limit=1.5', 'afterId=-1', 'afterId=nope']) {
      mocks.loadReviewQueue.mockClear();
      expect((await GET(new NextRequest(`http://localhost/api/data-intelligence/review?${query}`))).status).toBe(400);
      expect(mocks.loadReviewQueue).not.toHaveBeenCalled();
    }
  });

  it('returns source unavailability rather than an empty queue, and redacts private errors', async () => {
    mocks.loadReviewQueue.mockRejectedValue(new Error('postgres://private-user:private-secret@private-host'));
    const response = await GET(new NextRequest('http://localhost/api/data-intelligence/review'));
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toHaveProperty('error');
    expect(body).not.toHaveProperty('items');
    expect(JSON.stringify(body)).not.toContain('private-secret');
  });

  it('confirms only the selected journal snapshot and defaults learning to opt out', async () => {
    mocks.decideReview.mockResolvedValue({ success: true, journalId: 1, action: 'accept', categoryId: 2, remembered: false });
    const response = await POST(post({ journalId: 1, snapshot, action: 'accept' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.decideReview).toHaveBeenCalledWith({ journalId: 1, snapshot, action: 'accept', remember: false });
    expect(await response.json()).toMatchObject({ success: true, remembered: false });
  });

  it('passes a deliberate correction and explicit learning choice to the guarded writer', async () => {
    mocks.decideReview.mockResolvedValue({ success: true, journalId: 1, action: 'correct', categoryId: 3, remembered: true });
    const choice = { journalId: 1, snapshot, action: 'correct', categoryId: 3, remember: true };
    const response = await POST(post(choice));
    expect(response.status).toBe(200);
    expect(mocks.decideReview).toHaveBeenCalledWith(choice);
  });

  it.each([
    { journalId: 0, snapshot, action: 'accept' },
    { journalId: '1', snapshot, action: 'accept' },
    { journalId: 1.5, snapshot, action: 'accept' },
    { journalId: 1, action: 'accept' },
    { journalId: 1, snapshot: 'invalid', action: 'accept' },
    { journalId: 1, snapshot, action: 'delete' },
    { journalId: 1, snapshot, action: 'correct' },
    { journalId: 1, snapshot, action: 'correct', categoryId: -1 },
    { journalId: 1, snapshot, action: 'dismiss', categoryId: 1 },
    { journalId: 1, snapshot, action: 'dismiss', remember: true },
    { journalId: 1, snapshot, action: 'accept', propertyId: 7 },
    { journalId: 1, snapshot, action: 'accept', amount: '1000.00' },
    { journalId: 1, snapshot, action: 'accept', ownerId: 42 },
  ])('rejects invalid or unrelated mutation payload before any writer call: %j', async body => {
    expect((await POST(post(body))).status).toBe(400);
    expect(mocks.decideReview).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before querying or writing records', async () => {
    const request = new NextRequest('http://localhost/api/data-intelligence/review', { method: 'POST', body: '{malformed' });
    expect((await POST(request)).status).toBe(400);
    expect(mocks.decideReview).not.toHaveBeenCalled();
    expect(mocks.loadReviewQueue).not.toHaveBeenCalled();
  });

  it('returns a conflict after concurrent changes rather than false success', async () => {
    mocks.decideReview.mockRejectedValue(new CategorizationConflictError());
    const response = await POST(post({ journalId: 1, snapshot, action: 'accept' }));
    expect(response.status).toBe(409);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toHaveProperty('error');
  });

  it('returns an actionable category validation error and hides unknown provider failures', async () => {
    mocks.decideReview.mockRejectedValueOnce(new InvalidCategorizationError('Choose a current category.'));
    expect((await POST(post({ journalId: 1, snapshot, action: 'accept' }))).status).toBe(422);
    mocks.decideReview.mockRejectedValueOnce(new Error('postgres://private-secret@private-host'));
    const response = await POST(post({ journalId: 1, snapshot, action: 'accept' }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('private-secret');
  });
});
