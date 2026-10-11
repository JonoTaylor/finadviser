import { describe, expect, it } from 'vitest';
import { analyzePropertyOperations, operationsDateRanges } from './engine';
import { initialPropertyOperations, propertyOperationsSchema, validatePropertyReferences } from './types';

const property = { id: 1, name: 'Home', valuation: '200000', valuationDate: '2026-08-01', mortgageDebt: '120000' };
const tenancy = { id: 1, propertyId: 1, tenantName: 'Tenant', startDate: '2026-01-15', endDate: null, rentAmount: '1000', rentFrequency: 'monthly' as const };
const base = { asOf: '2026-10-11', properties: [property], tenancies: [tenancy], receipts: [], journalCoverage: [], data: initialPropertyOperations };

describe('property operating centre', () => {
  it('uses the last completed month and exactly 30 calendar days including today', () => {
    expect(operationsDateRanges('2026-01-31')).toEqual({ comparison: { month: '2025-12', startDate: '2025-12-01', endDate: '2025-12-31' }, upcomingStart: '2026-01-31', upcomingEnd: '2026-03-01' });
    const summary = analyzePropertyOperations(base);
    expect(summary.comparison.month).toBe('2026-09');
    expect(summary.upcoming.lines.map(row => row.dueDate)).toEqual(['2026-10-15']);
    expect(summary.upcoming.total).toBe('1000.00');
  });

  it('deducts property income refunds and distinguishes an unreconciled gap from arrears', () => {
    const summary = analyzePropertyOperations({ ...base, receipts: [
      { propertyId: 1, date: '2026-09-15', amount: '1000' },
      { propertyId: 1, date: '2026-09-17', amount: '-100' },
      { propertyId: 1, date: '2026-10-15', amount: '900' },
    ], journalCoverage: [{ propertyId: 1, date: '2026-09-15' }, { propertyId: 1, date: '2026-09-17' }] });
    expect(summary.properties[0]).toMatchObject({ scheduledRent: '1000.00', recordedIncome: '900.00', unreconciledRentGap: '100.00', incomeEntryCount: 2, loanToValuePercent: '60.0' });
    expect(summary.properties[0].coverage).toEqual({ journalCount: 2, firstDate: '2026-09-15', lastDate: '2026-09-17', completeness: 'unverified' });
    expect(summary.warnings.join(' ')).toContain('not tenant arrears');
  });

  it('does not turn absent monthly coverage into zero received rent or an arrears claim', () => {
    expect(analyzePropertyOperations(base).properties[0]).toMatchObject({ scheduledRent: '1000.00', recordedIncome: null, unreconciledRentGap: null, incomeEntryCount: 0, coverage: { journalCount: 0, completeness: 'unverified' } });
  });

  it('shows an expense-only recorded month as zero recorded income while keeping completeness unverified', () => {
    expect(analyzePropertyOperations({ ...base, journalCoverage: [{ propertyId: 1, date: '2026-09-05' }] }).properties[0]).toMatchObject({ recordedIncome: '0.00', unreconciledRentGap: '1000.00', coverage: { completeness: 'unverified' } });
  });

  it('keeps credits and surplus property income signed rather than clipping negative gaps', () => {
    const summary = analyzePropertyOperations({ ...base, receipts: [{ propertyId: 1, date: '2026-09-15', amount: '1200' }] });
    expect(summary.properties[0].unreconciledRentGap).toBe('-200.00');
  });

  it('excludes outgoing handover rent and schedules the incoming tenancy once', () => {
    const summary = analyzePropertyOperations({ ...base, asOf: '2026-09-01', tenancies: [
      { ...tenancy, startDate: '2026-01-15', endDate: '2026-09-15' },
      { ...tenancy, id: 2, tenantName: 'New tenant', startDate: '2026-09-15', rentAmount: '1100' },
    ] });
    expect(summary.upcoming.lines.map(row => [row.tenancyId, row.dueDate, row.amount])).toEqual([[2, '2026-09-15', '1100.00']]);
  });

  it('handles month-end anchors and weekly contracts without assuming monthly rent', () => {
    const summary = analyzePropertyOperations({ ...base, asOf: '2026-02-01', tenancies: [
      { ...tenancy, startDate: '2026-01-31' },
      { ...tenancy, id: 2, startDate: '2026-02-01', rentFrequency: 'weekly', rentAmount: '100' },
    ] });
    expect(summary.upcoming.lines.filter(row => row.tenancyId === 1).map(row => row.dueDate)).toEqual(['2026-02-28']);
    expect(summary.upcoming.lines.filter(row => row.tenancyId === 2).map(row => row.dueDate)).toEqual(['2026-02-01', '2026-02-08', '2026-02-15', '2026-02-22', '2026-03-01']);
    expect(summary.upcoming.total).toBe('1500.00');
  });

  it('completed obligations are never overdue or due soon and each ID is counted once', () => {
    const summary = analyzePropertyOperations({ ...base, data: { obligations: [
      { id: 'a', propertyId: 1, title: 'Past open', category: 'repair', dueDate: '2026-10-10', status: 'open' },
      { id: 'b', propertyId: 1, title: 'Past complete', category: 'inspection', dueDate: '2026-10-01', status: 'completed' },
      { id: 'c', propertyId: 1, title: 'Today', category: 'insurance', dueDate: '2026-10-11', status: 'open' },
      { id: 'd', propertyId: 1, title: '30th day', category: 'tax', dueDate: '2026-11-09', status: 'open' },
      { id: 'e', propertyId: 1, title: 'Outside window', category: 'mortgage', dueDate: '2026-11-10', status: 'open' },
    ], reserveTargets: [{ propertyId: 1, targetAmount: '5000.00' }] } });
    expect(summary.overdueCount).toBe(1);
    expect(summary.dueSoonCount).toBe(2);
    expect(summary.obligations.find(row => row.id === 'b')).toMatchObject({ isOverdue: false, isDueSoon: false });
    expect(summary.properties[0].reserveTarget).toBe('5000.00');
    expect(summary.properties[0].loanToValuePercent).toBe('60.0');
  });

  it('does not infer LTV from missing or zero valuations or unallocated shared mortgage balances', () => {
    for (const overrides of [{ valuation: null }, { valuation: '0' }, { mortgageDebt: null }]) {
      expect(analyzePropertyOperations({ ...base, properties: [{ ...property, ...overrides }] }).properties[0].loanToValuePercent).toBeNull();
    }
  });

  it('rejects malformed tenancy dates instead of silently normalising 31 February', () => {
    expect(() => analyzePropertyOperations({ ...base, tenancies: [{ ...tenancy, startDate: '2026-02-31' }] })).toThrow();
  });
});

describe('property task and reserve input validation', () => {
  const obligation = { id: 'stable-id', propertyId: 1, title: 'Insurance', category: 'insurance', dueDate: '2026-10-15', status: 'open' };
  it('normalises reserve pennies and rejects duplicate obligation IDs and property reserve entries', () => {
    expect(propertyOperationsSchema.parse({ obligations: [], reserveTargets: [{ propertyId: 1, targetAmount: '100.2' }] }).reserveTargets[0].targetAmount).toBe('100.20');
    expect(propertyOperationsSchema.safeParse({ obligations: [obligation, obligation], reserveTargets: [] }).success).toBe(false);
    expect(propertyOperationsSchema.safeParse({ obligations: [], reserveTargets: [{ propertyId: 1, targetAmount: null }, { propertyId: 1, targetAmount: '0' }] }).success).toBe(false);
  });
  it.each(['2026-02-30', 'not-a-date'])('rejects invalid due dates: %s', dueDate => {
    expect(propertyOperationsSchema.safeParse({ obligations: [{ ...obligation, dueDate }], reserveTargets: [] }).success).toBe(false);
  });
  it.each(['-1', '1.001', 'NaN', '1000000000000'])('rejects unsafe reserve amounts: %s', targetAmount => {
    expect(propertyOperationsSchema.safeParse({ obligations: [], reserveTargets: [{ propertyId: 1, targetAmount }] }).success).toBe(false);
  });
  it('rejects unknown fields and properties before persistence', () => {
    expect(propertyOperationsSchema.safeParse({ obligations: [{ ...obligation, statutoryVerified: true }], reserveTargets: [] }).success).toBe(false);
    expect(() => validatePropertyReferences(propertyOperationsSchema.parse({ obligations: [obligation], reserveTargets: [] }), [2])).toThrow('Choose an existing property');
    expect(() => validatePropertyReferences({ obligations: [], reserveTargets: [{ propertyId: 9, targetAmount: '100' }] }, [1])).toThrow();
  });
});
