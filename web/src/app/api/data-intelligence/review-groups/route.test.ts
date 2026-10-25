import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CategorizationConflictError, InvalidCategorizationError } from '@/lib/categorization/review';

const mocks = vi.hoisted(() => ({ load: vi.fn(), decide: vi.fn() }));
vi.mock('@/lib/categorization/review-groups', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/categorization/review-groups')>(), loadReviewGroups: mocks.load, decideReviewGroup: mocks.decide,
}));
import { GET, POST } from './route';

const choice = { groupKey: 'a'.repeat(64), items: [{ journalId: 1, snapshot: 'b'.repeat(32), reviewVersion: 'c'.repeat(32) }], action: 'correct', categoryId: 2, remember: false };
const post = (body: unknown) => POST(new NextRequest('http://localhost/api/data-intelligence/review-groups', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
beforeEach(() => vi.resetAllMocks());
describe('grouped payment review API', () => {
  it('loads bounded groups with a stable cursor and private no-store response', async () => {
    const queue = { groups: [], totalPayments: 0, totalGroups: 0, hasMore: false, nextCursor: null, categories: [] };
    mocks.load.mockResolvedValue(queue);
    const response = await GET(new NextRequest(`http://localhost/api/data-intelligence/review-groups?limit=10&afterKey=${'a'.repeat(64)}`));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(queue);
    expect(mocks.load).toHaveBeenCalledWith(10, 'a'.repeat(64)); expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it('rejects unbounded or malformed queries before reading records', async () => {
    for (const query of ['limit=16', 'afterKey=merchant', 'includeAll=true']) {
      expect((await GET(new NextRequest(`http://localhost/api/data-intelligence/review-groups?${query}`))).status).toBe(400);
    }
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it('reports unavailable reads without pretending the queue is empty', async () => {
    mocks.load.mockRejectedValue(new Error('private SQL and payment data'));
    const response = await GET(new NextRequest('http://localhost/api/data-intelligence/review-groups'));
    expect(response.status).toBe(503); const body = await response.json();
    expect(body).not.toHaveProperty('groups'); expect(JSON.stringify(body)).not.toContain('private SQL');
  });
  it('acknowledges only the explicit decision passed to the atomic service', async () => {
    const result = { success: true, groupKey: choice.groupKey, action: 'correct', categoryId: 2, appliedCount: 1, remembered: false, journalIds: [1] };
    mocks.decide.mockResolvedValue(result); const response = await post(choice);
    expect(response.status).toBe(200); expect(await response.json()).toEqual(result); expect(mocks.decide).toHaveBeenCalledWith(choice);
  });
  it('rejects malformed, duplicate or hidden-scope selections before a write', async () => {
    for (const body of [{ ...choice, items: [] }, { ...choice, items: [...choice.items, ...choice.items] }, { ...choice, includeAllMatching: true }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect(mocks.decide).not.toHaveBeenCalled();
  });
  it('returns a conflict when one member or its suggestion changed', async () => {
    mocks.decide.mockRejectedValue(new CategorizationConflictError()); const response = await post(choice);
    expect(response.status).toBe(409); expect((await response.json()).error).toContain('No group decision was applied');
  });
  it('explains an unsupported category decision', async () => {
    mocks.decide.mockRejectedValue(new InvalidCategorizationError('Choose a category.'));
    const response = await post(choice); expect(response.status).toBe(422); expect(await response.json()).toEqual({ error: 'Choose a category.' });
  });
  it('does not claim no writes happened if the final save outcome is unknown', async () => {
    mocks.decide.mockRejectedValue(new Error('private SQL and payment data'));
    const response = await post(choice); expect(response.status).toBe(503);
    const body = await response.json(); expect(body.error).toContain('could not be confirmed');
    expect(body.error).not.toContain('No group decision'); expect(body.error).not.toContain('private SQL');
  });
});
