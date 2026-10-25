import { describe, expect, it } from 'vitest';
import { reviewGroupDecisionSchema } from './review-groups';

const base = { groupKey: 'a'.repeat(64), items: [{ journalId: 1, snapshot: 'b'.repeat(32), reviewVersion: 'c'.repeat(32) }], action: 'correct', categoryId: 2, remember: false };
describe('bounded explicit grouped review selections', () => {
  it('requires the actual suggestion revision as well as journal snapshot', () => {
    expect(reviewGroupDecisionSchema.safeParse(base).success).toBe(true);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, items: [{ journalId: 1, snapshot: 'b'.repeat(32) }] }).success).toBe(false);
  });
  it('rejects empty, duplicated and oversized selections', () => {
    for (const items of [[], [base.items[0], base.items[0]], Array.from({ length: 101 }, (_, i) => ({ ...base.items[0], journalId: i + 1 }))]) {
      expect(reviewGroupDecisionSchema.safeParse({ ...base, items }).success).toBe(false);
    }
  });
  it('requires a specific category for corrections and forbids learning from dismissals', () => {
    expect(reviewGroupDecisionSchema.safeParse({ ...base, categoryId: undefined }).success).toBe(false);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, action: 'dismiss' }).success).toBe(false);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, action: 'dismiss', categoryId: undefined, remember: true }).success).toBe(false);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, action: 'dismiss', categoryId: undefined }).success).toBe(true);
  });
  it('rejects hidden scope parameters and malformed group or snapshot identifiers', () => {
    expect(reviewGroupDecisionSchema.safeParse({ ...base, includeAllMatching: true }).success).toBe(false);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, groupKey: 'merchant-name' }).success).toBe(false);
    expect(reviewGroupDecisionSchema.safeParse({ ...base, items: [{ ...base.items[0], reviewVersion: 'old' }] }).success).toBe(false);
  });
});
