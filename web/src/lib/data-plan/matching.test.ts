import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, findMatches, isMortgageInterestLine } from './matching';
import { line } from './test-fixtures';

const base = {
  kind: 'expense' as const,
  propertyId: 10,
  date: '2025-09-05',
  amount: '191.12',
  alternateAmounts: [] as string[],
  windowDays: 5,
  claimedJournalIds: new Set<number>(),
};

const expenseLine = (over: Record<string, unknown> = {}) =>
  line({ date: '2025-09-06', amount: '191.12', accountName: 'Uncategorized Expense', accountType: 'EXPENSE', ...over });

describe('date helpers', () => {
  it('counts whole days either way and crosses month/year ends', () => {
    expect(daysBetween('2025-09-05', '2025-09-10')).toBe(5);
    expect(daysBetween('2025-09-10', '2025-09-05')).toBe(-5);
    expect(daysBetween('2025-12-30', '2026-01-02')).toBe(3);
    expect(addDays('2025-04-06', -5)).toBe('2025-04-01');
    expect(addDays('2026-04-05', 5)).toBe('2026-04-10');
  });
});

describe('findMatches', () => {
  it('matches the same amount within +/- the window and not outside it', () => {
    const within = expenseLine({ date: '2025-09-10' }); // +5
    const outside = expenseLine({ date: '2025-09-11' }); // +6
    const before = expenseLine({ date: '2025-08-31' }); // -5
    const r = findMatches([within, outside, before], base);
    expect(r.untagged.map(m => m.line.journalId).sort()).toEqual([within.journalId, before.journalId].sort());
  });

  it('needs the exact amount', () => {
    const r = findMatches([expenseLine({ amount: '191.13' }), expenseLine({ amount: '191.1' })], base);
    expect(r.untagged).toHaveLength(0);
  });

  it('buckets by property tag: same property, untagged, other property', () => {
    const tagged = expenseLine({ propertyId: 10, accountName: 'Property Expenses' });
    const untagged = expenseLine({ propertyId: null });
    const other = expenseLine({ propertyId: 20 });
    const r = findMatches([tagged, untagged, other], base);
    expect(r.tagged.map(m => m.line.journalId)).toEqual([tagged.journalId]);
    expect(r.untagged.map(m => m.line.journalId)).toEqual([untagged.journalId]);
    expect(r.otherProperty.map(m => m.line.journalId)).toEqual([other.journalId]);
  });

  it('respects the sign: a refund is not a duplicate of the payment', () => {
    const refund = expenseLine({ amount: '-191.12' });
    expect(findMatches([refund], base).untagged).toHaveLength(0);
    // and income needs a credit
    const credit = line({ date: '2025-09-05', amount: '-50.00', accountName: 'Uncategorized Income', accountType: 'INCOME' });
    const debit = line({ date: '2025-09-05', amount: '50.00', accountName: 'Uncategorized Income', accountType: 'INCOME' });
    const r = findMatches([credit, debit], { ...base, kind: 'income', amount: '50.00' });
    expect(r.untagged.map(m => m.line.journalId)).toEqual([credit.journalId]);
  });

  it('ignores the Mortgage Interest account for ordinary expenses', () => {
    const mi = expenseLine({ accountName: 'Mortgage Interest', propertyId: 10 });
    expect(isMortgageInterestLine(mi)).toBe(true);
    expect(findMatches([mi], base).tagged).toHaveLength(0);
  });

  it('lets a mortgage item match any expense debit (a mis-booked payment is still the same cash)', () => {
    const mi = expenseLine({ accountName: 'Mortgage Interest', propertyId: 10, amount: '400.00', date: '2025-05-31' });
    const wrong = expenseLine({ accountName: 'Property Expenses', propertyId: 10, amount: '400.00', date: '2025-06-01' });
    const r = findMatches([mi, wrong], { ...base, kind: 'mortgage_interest', amount: '400.00', date: '2025-05-31' });
    expect(r.tagged).toHaveLength(2);
    expect(r.tagged[0].line.journalId).toBe(mi.journalId); // closest date first
  });

  it('flags a real mortgage payment already booked for another amount (mortgage items only)', () => {
    const real = expenseLine({ accountName: 'Mortgage Interest', propertyId: 10, amount: '1398.00', date: '2025-06-01' });
    const mortgageQuery = { ...base, kind: 'mortgage_interest' as const, amount: '1382.36', date: '2025-05-31' };
    const r = findMatches([real], mortgageQuery);
    expect(r.differentAmount.map(m => m.line.journalId)).toEqual([real.journalId]);
    expect(r.tagged).toHaveLength(0);
    // an ordinary expense item is not affected by other amounts
    expect(findMatches([{ ...real, accountName: 'Property Expenses' }], { ...base, amount: '1382.36' }).differentAmount).toHaveLength(0);
    // nor is a different property, an untagged line, or a date outside the window
    expect(findMatches([{ ...real, propertyId: 20 }], mortgageQuery).differentAmount).toHaveLength(0);
    expect(findMatches([{ ...real, propertyId: null }], mortgageQuery).differentAmount).toHaveLength(0);
    expect(findMatches([{ ...real, date: '2025-06-10' }], mortgageQuery).differentAmount).toHaveLength(0);
  });

  it('puts alternate-amount matches in their own bucket', () => {
    const net = line({ date: '2025-07-08', amount: '-477.30', accountName: 'Uncategorized Income', accountType: 'INCOME' });
    const r = findMatches([net], {
      ...base,
      kind: 'income',
      amount: '495.12',
      date: '2025-07-03',
      alternateAmounts: ['477.30'],
    });
    expect(r.alternate).toHaveLength(1);
    expect(r.alternate[0].viaAlternate).toBe(true);
    expect(r.untagged).toHaveLength(0);
  });

  it('skips journals already claimed by an earlier item', () => {
    const l = expenseLine();
    const r = findMatches([l], { ...base, claimedJournalIds: new Set([l.journalId]) });
    expect(r.untagged).toHaveLength(0);
  });

  it('reports a journal once even if it has two qualifying legs', () => {
    const a = expenseLine();
    const b = { ...a, bookEntryId: a.bookEntryId + 1, accountName: 'Property Expenses' };
    expect(findMatches([a, b], base).untagged).toHaveLength(1);
  });

  it('orders candidates by closeness then id', () => {
    const far = expenseLine({ date: '2025-09-09' });
    const near = expenseLine({ date: '2025-09-05' });
    const r = findMatches([far, near], base);
    expect(r.untagged.map(m => m.line.journalId)).toEqual([near.journalId, far.journalId]);
  });
});
