import { describe, expect, it } from 'vitest';
import { planChanges } from './planner';
import { simulateChanges } from './simulate';
import { computeOwnerTotals } from './totals';
import { baseState, basePlan, line, OWNER_ID, ROAD_ID } from './test-fixtures';

describe('simulateChanges', () => {
  it('does not mutate the input state', () => {
    const state = baseState();
    const before = JSON.stringify(state);
    simulateChanges(state, planChanges(basePlan(), state).changes);
    expect(JSON.stringify(state)).toBe(before);
  });

  it('predicts the totals the plan should produce', () => {
    const state = baseState();
    const result = planChanges(basePlan(), state);
    const after = simulateChanges(state, result.changes);
    const t = computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state: after });
    const road = t.properties.find(p => p.propertyId === ROAD_ID)!;
    // tenancy 2024-09-01 .. 2026-03-01 monthly 1000: dues 1 May 2025 .. 1 Mar 2026 = 11, at 50%
    expect(road.scheduledRentLines).toBe(11);
    expect(road.scheduledRent).toBe('5500.00');
    expect(road.totalExpenses).toBe('150.00'); // 300 insurance at 50%
    expect(road.mortgageInterest).toBe('200.00'); // 400 at 50%
    const street = t.properties.find(p => p.propertyName === '2 Sample Street')!;
    expect(street.otherIncome).toBe('150.00'); // 250 at 60%
    expect(street.totalExpenses).toBe('6.00'); // 10 at 60%
  });

  it('moves a tagged journal from candidates to tagged so it starts counting', () => {
    const state = baseState();
    const untagged = line({ date: '2025-07-03', amount: '300.00', accountName: 'Uncategorized Expense', accountType: 'EXPENSE' });
    state.candidateLines = [untagged];
    const before = computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state });
    expect(before.combined.totalExpenses).toBe('0.00');
    const result = planChanges(basePlan(), state);
    const after = simulateChanges(state, result.changes);
    expect(after.candidateLines).toHaveLength(0);
    expect(after.taggedLines.some(l => l.journalId === untagged.journalId && l.propertyId === ROAD_ID)).toBe(true);
    expect(computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state: after }).combined.totalExpenses).toBe('156.00'); // 150 insurance + 6 platform fee
  });

  it('applies the tenancy update to an existing tenancy', () => {
    const state = baseState();
    state.tenancies = [
      { id: 3, propertyId: ROAD_ID, tenantName: 'P. Tenant', startDate: '2024-09-01', endDate: '2026-08-31', rentAmount: '1000.00', rentFrequency: 'monthly', depositAmount: null, notes: null },
    ];
    const after = simulateChanges(state, planChanges(basePlan(), state).changes);
    expect(after.tenancies).toHaveLength(1);
    expect(after.tenancies[0].endDate).toBe('2026-03-01');
    expect(after.tenancies[0].tenantName).toBe('P. Tenant'); // not marked update
  });
});
