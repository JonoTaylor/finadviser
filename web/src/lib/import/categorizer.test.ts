import { beforeEach, describe, expect, it, vi } from 'vitest';

const getRules = vi.hoisted(() => vi.fn());
vi.mock('@/lib/repos', () => ({ categoryRepo: { getRules } }));

import { categorizeTransactions, matchRule } from './categorizer';

beforeEach(() => { getRules.mockReset(); });

describe('safe import rule matching', () => {
  it('does not replay AI-generated broad merchant guesses as rules', () => {
    for (const matchType of ['contains', 'startswith', 'regex', null]) {
      expect(matchRule('Tesco Express', [
        { pattern: 'Tesco', categoryId: 1, matchType, source: 'ai' },
      ])).toBeNull();
    }
  });

  it('does not treat unreviewed legacy exact AI rules as confirmations', () => {
    const rules = [{ pattern: 'Tesco Express', categoryId: 1, matchType: 'exact', source: 'ai' }];
    expect(matchRule('TESCO EXPRESS', rules)).toBeNull();
    expect(matchRule('Tesco Express transfer', rules)).toBeNull();
  });

  it('keeps explicitly configured user and system matching behavior', () => {
    expect(matchRule('Tesco Express', [{ pattern: 'Tesco', categoryId: 2, matchType: 'contains', source: 'user' }])).toBe(2);
    expect(matchRule('Tesco Express', [{ pattern: '^Tesco', categoryId: 3, matchType: 'regex', source: 'system' }])).toBe(3);
    expect(matchRule('Tesco Express', [{ pattern: 'Tesco', categoryId: 4, matchType: null }])).toBe(4);
  });

  it('ignores invalid regular expressions without blocking import preview', () => {
    expect(matchRule('Tesco Express', [
      { pattern: '[', categoryId: 1, matchType: 'regex', source: 'user' },
      { pattern: 'Tesco', categoryId: 2, matchType: 'contains', source: 'user' },
    ])).toBe(2);
  });

  it('uses safe merchant hints and leaves duplicates untouched', async () => {
    getRules.mockResolvedValue([
      { pattern: 'Tesco', categoryId: 1, matchType: 'contains', source: 'ai' },
      { pattern: 'Tesco Express', categoryId: 2, matchType: 'exact', source: 'user' },
    ]);
    const transaction = {
      date: '2026-10-12', description: 'Card payment', amount: '-5.00',
      reference: null, fingerprint: 'a', isDuplicate: false, suggestedCategoryId: null,
      metadata: { merchantName: 'Tesco Express' },
    };
    const duplicate = { ...transaction, fingerprint: 'b', isDuplicate: true, suggestedCategoryId: 9 };
    expect(await categorizeTransactions([transaction, duplicate])).toMatchObject([
      { suggestedCategoryId: 2 }, { suggestedCategoryId: 9 },
    ]);
  });

  it('previews the highest-priority approved match consistently with automatic processing', async () => {
    getRules.mockResolvedValue([
      { id: 1, pattern: 'Amazon', categoryId: 1, matchType: 'contains', source: 'user', priority: 0 },
      { id: 2, pattern: 'Amazon Books', categoryId: 2, matchType: 'exact', source: 'user', priority: 10 },
      { id: 3, pattern: 'Amazon', categoryId: 3, matchType: 'contains', source: 'ai', priority: 100 },
    ]);
    const result = await categorizeTransactions([{ date: '2026-10-12', description: 'Amazon Books', amount: '-15.00', reference: null, fingerprint: 'priority', isDuplicate: false, suggestedCategoryId: null }]);
    expect(result[0].suggestedCategoryId).toBe(2);
  });
});
