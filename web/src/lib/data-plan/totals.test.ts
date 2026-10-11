import { describe, expect, it } from 'vitest';
import { computeOwnerTotals, resolveAllocationPct, totalsEqual } from './totals';
import { baseState, line, OWNER_ID, ROAD_ID, STREET_ID } from './test-fixtures';
import type { DbState, TenancyRow } from './types';

const tenancy = (over: Partial<TenancyRow> = {}): TenancyRow => ({
  id: 1,
  propertyId: ROAD_ID,
  tenantName: 'Pat Tenant',
  startDate: '2024-06-01',
  endDate: '2026-02-01',
  rentAmount: '2200.00',
  rentFrequency: 'monthly',
  depositAmount: null,
  notes: null,
  ...over,
});

function totalsFor(state: DbState) {
  return computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state });
}

describe('computeOwnerTotals mirrors the tax report', () => {
  it('counts 10 rent dues for a tenancy anchored on the 1st that ends 1 Feb 2026 (inclusive)', () => {
    const state = baseState();
    state.tenancies = [tenancy()];
    const road = totalsFor(state).properties.find(p => p.propertyId === ROAD_ID)!;
    // 1 May 2025 ... 1 Feb 2026 = 10 dues; Alex's equal-split share is 50%
    expect(road.scheduledRentLines).toBe(10);
    expect(road.scheduledRent).toBe('11000.00');
    expect(road.grossIncome).toBe('11000.00');
  });

  it('would count 12 dues for the same tenancy running to the contract end, and 9 if it ended 31 Jan', () => {
    const open = baseState();
    open.tenancies = [tenancy({ endDate: '2026-05-31' })];
    expect(totalsFor(open).properties[0].scheduledRentLines).toBe(12);
    const early = baseState();
    early.tenancies = [tenancy({ endDate: '2026-01-31' })];
    expect(totalsFor(early).properties[0].scheduledRentLines).toBe(9);
  });

  it('rounds the owner share per line, then sums the rounded lines', () => {
    const state = baseState();
    // 3 expense lines of 0.05 at 50%: each 0.025 -> 0.03 (half up) => 0.09, not 0.075 -> 0.08
    state.taggedLines = [0, 1, 2].map(i =>
      line({ date: `2025-08-0${i + 1}`, amount: '0.05', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID }),
    );
    expect(totalsFor(state).properties.find(p => p.propertyId === ROAD_ID)!.totalExpenses).toBe('0.09');
  });

  it('flips income to positive, keeps mortgage interest apart from expenses, and drops transfers', () => {
    const state = baseState();
    state.taggedLines = [
      line({ date: '2025-08-01', amount: '-100.00', accountName: 'Uncategorized Income', accountType: 'INCOME', propertyId: STREET_ID }),
      line({ date: '2025-08-02', amount: '40.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: STREET_ID }),
      line({ date: '2025-08-03', amount: '500.00', accountName: 'Mortgage Interest', accountType: 'EXPENSE', propertyId: STREET_ID }),
      line({ date: '2025-08-04', amount: '999.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: STREET_ID, isTransfer: true }),
      // a user account that merely shares the name but is not the protected system account
      line({ date: '2025-08-05', amount: '10.00', accountName: 'Mortgage Interest', accountType: 'EXPENSE', propertyId: STREET_ID, accountIsSystem: false }),
    ];
    const street = totalsFor(state).properties.find(p => p.propertyId === STREET_ID)!;
    expect(street.allocationPct).toBe('60.0000');
    expect(street.otherIncome).toBe('60.00');
    expect(street.totalExpenses).toBe('30.00'); // 40 + 10 at 60%
    expect(street.mortgageInterest).toBe('300.00');
    expect(street.netBeforeMortgageRelief).toBe('30.00');
  });

  it('only counts lines inside the tax year, inclusive of both end dates', () => {
    const state = baseState();
    state.taggedLines = ['2025-04-05', '2025-04-06', '2026-04-05', '2026-04-06'].map(date =>
      line({ date, amount: '10.00', accountName: 'Property Expenses', accountType: 'EXPENSE', propertyId: ROAD_ID }),
    );
    expect(totalsFor(state).properties.find(p => p.propertyId === ROAD_ID)!.totalExpenses).toBe('10.00'); // 2 lines x 10 x 50%
  });

  it('sums every property the owner has a stake in', () => {
    const state = baseState();
    state.tenancies = [tenancy()];
    state.taggedLines = [line({ date: '2025-08-01', amount: '-100.00', accountName: 'Uncategorized Income', accountType: 'INCOME', propertyId: STREET_ID })];
    const t = totalsFor(state);
    expect(t.combined.grossIncome).toBe('11060.00');
    expect(t.properties.map(p => p.propertyName)).toEqual(['1 Example Road', '2 Sample Street']);
  });

  it('falls back to an equal split when there is no allocation rule, and throws for a non-owner', () => {
    const state = baseState();
    expect(resolveAllocationPct(ROAD_ID, 1, state.allocationRules, state.ownership).toString()).toBe('50');
    expect(() => resolveAllocationPct(ROAD_ID, 99, state.allocationRules, state.ownership)).toThrow(/not an owner/);
  });

  it('totalsEqual compares all four figures', () => {
    const a = { grossIncome: '1.00', totalExpenses: '2.00', mortgageInterest: '3.00', netBeforeMortgageRelief: '-1.00' };
    expect(totalsEqual(a, { ...a })).toBe(true);
    expect(totalsEqual(a, { ...a, mortgageInterest: '3.01' })).toBe(false);
  });
});
