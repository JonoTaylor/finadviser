import { describe, expect, it } from 'vitest';
import { actionReviewState, compareReviews } from './engine';
import { reviewEditableSchema, type ActionRecord, type ReviewSnapshot } from './schema';
const fingerprint = 'a'.repeat(64);
const action = { id: 'reserve', evidenceFingerprint: fingerprint };
const record: ActionRecord = { ...action, status: 'completed', note: '', dueDate: null };
describe('reviewed financial actions', () => {
  it('retains the recorded decision without claiming the underlying condition is fixed', () => {
    expect(actionReviewState(action, [record], '2026-10-11')).toMatchObject({ status: 'completed', evidenceChanged: false, recordedStatus: 'completed' });
  });
  it('resurfaces changed evidence while preserving prior user notes and status', () => {
    expect(actionReviewState({ ...action, evidenceFingerprint: 'b'.repeat(64) }, [record], '2026-10-11')).toMatchObject({ status: 'planned', evidenceChanged: true, saved: record, recordedStatus: 'completed' });
  });
  it('resurfaces deferred actions on the exact review date', () => {
    const deferred = { ...record, status: 'deferred' as const, dueDate: '2026-10-11' };
    expect(actionReviewState(action, [deferred], '2026-10-10').status).toBe('deferred');
    expect(actionReviewState(action, [deferred], '2026-10-11')).toMatchObject({ status: 'planned', reviewDue: true });
  });
  it('requires a meaningful deferral date and rejects duplicates', () => {
    expect(reviewEditableSchema.safeParse({ actions: [{ ...record, status: 'deferred' }], recurring: [] }).success).toBe(false);
    expect(reviewEditableSchema.safeParse({ actions: [record, record], recurring: [] }).success).toBe(false);
    expect(reviewEditableSchema.safeParse({ actions: [], recurring: [{ merchant: 'Shop', status: 'confirmed', note: '', expectedMonthlySaving: null }, { merchant: 'shop', status: 'dismissed', note: '', expectedMonthlySaving: null }] }).success).toBe(false);
  });
});
const snapshot: ReviewSnapshot = {
  id: 'eaa5b3c8-90f0-4ab3-b6b3-21b7cb02ab17', recordedAt: '2026-10-11T12:00:00.000Z', asOf: '2026-10-11',
  scope: 'household', currency: 'GBP', selectedOwnerId: 2,
  period: { start: '2026-07-01', end: '2026-09-30', monthsRecorded: 3 },
  metrics: { monthlyIncome: '3000.00', monthlySpending: '2000.01', monthlySurplus: '999.99', netWorth: '100000.01', cashReserve: '5000.00', reserveShortfall: null, debt: '2000.00' },
  workspaceRevisions: {}, warnings: [],
};
describe('household review snapshots', () => {
  it('needs a previous review', () => expect(compareReviews(snapshot, null)).toBeNull());
  it('keeps penny-accurate changes and unknown measurements', () => {
    expect(compareReviews({ ...snapshot, metrics: { ...snapshot.metrics, monthlySpending: '1999.99', debt: '1999.01' } }, snapshot)).toMatchObject({ monthlySpending: '-0.02', debt: '-0.99', reserveShortfall: null, samePeriod: true });
  });
  it('shows both periods rather than claiming investment return or realised savings', () => {
    const next = { ...snapshot, asOf: '2026-11-11', period: { start: '2026-08-01', end: '2026-10-31', monthsRecorded: 3 } };
    const comparison = compareReviews(next, snapshot)!;
    expect(comparison.samePeriod).toBe(false);
    expect(comparison.basis).toContain('not realised savings');
    expect(comparison.currentPeriod.start).toBe('2026-08-01');
  });
});
