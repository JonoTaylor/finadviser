import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReviewGroup, ReviewGroupsQueue } from '@/lib/categorization/review-groups';
import { fetchReviewGroups, freezeReviewSelection, GroupReviewCard, groupNeedsMovementReview, groupPreviewSummary, groupSuggestedCategory, parseReviewGroups, signedPaymentAmount, validateGroupAcknowledgement } from './GroupedCategorizationReviewQueue';

const group: ReviewGroup = {
  key: 'a'.repeat(64), paymentCount: 2, hasMore: false,
  items: [1, 2].map(journalId => ({
    journalId, date: journalId === 1 ? '2024-05-16' : '2024-06-16', description: 'Example service membership', merchantName: 'Example service',
    currency: 'GBP', propertyId: null, legs: [{ accountId: 10, accountName: 'Household account', accountType: 'ASSET', ownerId: null, amount: '-8.99' }],
    suggestedCategoryId: 3, suggestedCategoryName: 'Subscriptions', confidence: 0.85, reason: 'A recurring service.', evidence: null,
    snapshot: 'b'.repeat(32), updatedAt: '2026-10-25T14:00:00.000Z', reviewVersion: 'c'.repeat(32),
  })),
};
const queue: ReviewGroupsQueue = { groups: [group], totalPayments: 2, totalGroups: 1, nextCursor: null, hasMore: false, categories: [{ id: 3, name: 'Subscriptions', parentId: null }] };
const acknowledgement = { success: true, groupKey: group.key, action: 'accept', categoryId: 3, appliedCount: 2, remembered: true, journalIds: [1, 2] };

afterEach(() => vi.unstubAllGlobals());

describe('grouped payment review boundaries', () => {
  it('freezes the explicit payment IDs, evidence, categories and versions when a preview opens', () => {
    const original = structuredClone(group);
    const categories = structuredClone(queue.categories);
    const selected = freezeReviewSelection(original, categories);
    original.items.push({ ...original.items[0], journalId: 99 });
    original.items[0].snapshot = 'd'.repeat(32);
    original.items[0].legs[0].amount = '-100';
    categories[0].name = 'Changed';
    expect(selected.group.items.map(item => item.journalId)).toEqual([1, 2]);
    expect(selected.group.items[0].snapshot).toBe('b'.repeat(32));
    expect(selected.group.items[0].legs[0].amount).toBe('-8.99');
    expect(selected.categories[0].name).toBe('Subscriptions');
  });

  it('requires acknowledgement of exactly the frozen IDs, action, category, count and learning choice', () => {
    expect(validateGroupAcknowledgement({ ...acknowledgement, journalIds: [2, 1] }, group, 'accept', 3, true)).toEqual({ ...acknowledgement, journalIds: [2, 1] });
    for (const change of [{ appliedCount: 1 }, { journalIds: [1, 99] }, { journalIds: [1, 1] }, { action: 'correct' }, { categoryId: 4 }, { groupKey: 'd'.repeat(64) }, { remembered: false }, { success: false }]) {
      expect(() => validateGroupAcknowledgement({ ...acknowledgement, ...change }, group, 'accept', 3, true)).toThrow('could not be confirmed');
    }
    expect(validateGroupAcknowledgement({ ...acknowledgement, action: 'dismiss', categoryId: null, remembered: false }, group, 'dismiss', null, true).appliedCount).toBe(2);
  });

  it('does not treat a partial, duplicate or contradictory group response as an empty queue', () => {
    expect(parseReviewGroups(queue)).toEqual(queue);
    for (const badGroup of [{ ...group, paymentCount: 1 }, { ...group, paymentCount: 3 }, { ...group, items: [group.items[0], group.items[0]] }, { ...group, items: [] }, { ...group, items: [{ ...group.items[0], reviewVersion: 'invalid' }] }]) {
      expect(() => parseReviewGroups({ ...queue, groups: [badGroup] })).toThrow('could not be verified');
    }
    for (const invalid of [{ ...queue, totalPayments: 0 }, { ...queue, totalGroups: 0 }, { ...queue, totalGroups: 3 }, { ...queue, hasMore: true }, { ...queue, nextCursor: 'd'.repeat(64) }, { ...queue, groups: [group, group] }]) {
      expect(() => parseReviewGroups(invalid)).toThrow('could not be verified');
    }
  });

  it('fetches without a cached response and keeps failures out of successful queue data', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(queue)));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchReviewGroups('/api/data-intelligence/review-groups?limit=15')).toEqual(queue);
    expect(fetch).toHaveBeenCalledWith('/api/data-intelligence/review-groups?limit=15', { cache: 'no-store' });
    fetch.mockResolvedValue(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }));
    await expect(fetchReviewGroups('/api/data-intelligence/review-groups')).rejects.toThrow('Unavailable');
  });
});

describe('grouped review presentation', () => {
  it('shows the exact preview total without floating-point addition or mixing account postings', () => {
    expect(groupPreviewSummary(group)).toEqual({ dateRange: '2024-05-16 to 2024-06-16', amount: '−17.98', currency: 'GBP', accountNames: ['Household account'] });
    expect(signedPaymentAmount('1000000.01')).toBe('+1,000,000.01');
    expect(signedPaymentAmount('0')).toBe('0.00');
    const multiple = structuredClone(group);
    multiple.items[0].legs.push({ ...multiple.items[0].legs[0], accountId: 11, amount: '8.99' });
    expect(groupPreviewSummary(multiple).amount).toBeNull();
    multiple.items[0].legs.pop();
    multiple.items[0].currency = 'EUR';
    expect(groupPreviewSummary(multiple).amount).toBeNull();
  });

  it('does not preselect a category when suggestions disagree', () => {
    expect(groupSuggestedCategory(group)).toBe(3);
    expect(groupSuggestedCategory({ ...group, items: [group.items[0], { ...group.items[1], suggestedCategoryId: 4 }] })).toBeNull();
    expect(groupSuggestedCategory({ ...group, items: [{ ...group.items[0], suggestedCategoryId: null }] })).toBeNull();
  });

  it('distinguishes an account-movement question from an ordinary merchant question without assigning a category', () => {
    expect(groupNeedsMovementReview(group)).toBe(false);
    expect(groupNeedsMovementReview({ ...group, items: [{ ...group.items[0], merchantName: 'AMERICAN EXP 3773' }] })).toBe(true);
    expect(groupNeedsMovementReview({ ...group, items: [{ ...group.items[0], merchantName: 'FNZ' }] })).toBe(true);
    expect(groupNeedsMovementReview({ ...group, items: [{ ...group.items[0], reason: 'This may be a savings deposit.' }] })).toBe(true);
  });

  it('makes a bounded preview distinct from the whole context group', () => {
    const html = renderToString(createElement(GroupReviewCard, { group: { ...group, paymentCount: 200, hasMore: true }, onOpen: () => {} })).replace(/<!-- -->/g, '');
    for (const text of ['200 payments', 'first 2 shown', 'Review these 2', '−17.98', 'in this preview', 'Household account']) expect(html).toContain(text);
    expect(html).not.toContain('Apply to 200');
  });
});
