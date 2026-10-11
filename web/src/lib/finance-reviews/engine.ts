import Decimal from 'decimal.js';
import type { ActionRecord, ReviewSnapshot } from './schema';

/** Completion records a user's action; it never certifies a financial condition resolved. */
export function actionReviewState(action: { id: string; evidenceFingerprint: string }, records: ActionRecord[], asOf: string) {
  const saved = records.find(record => record.id === action.id);
  const evidenceChanged = Boolean(saved && saved.evidenceFingerprint !== action.evidenceFingerprint);
  const reviewDue = Boolean(saved?.status === 'deferred' && saved.dueDate !== null && saved.dueDate <= asOf);
  return {
    saved: saved ?? null,
    status: evidenceChanged || reviewDue ? 'planned' as const : saved?.status ?? 'planned' as const,
    evidenceChanged,
    reviewDue,
    recordedStatus: saved?.status ?? null,
  };
}

export function compareReviews(latest: ReviewSnapshot, previous: ReviewSnapshot | null) {
  if (previous === null) return null;
  const comparable = latest.scope === previous.scope && latest.currency === previous.currency;
  const delta = (field: keyof ReviewSnapshot['metrics']) => comparable && latest.metrics[field] !== null && previous.metrics[field] !== null
    ? new Decimal(latest.metrics[field]!).minus(previous.metrics[field]!).toFixed(2) : null;
  return {
    previousAsOf: previous.asOf, currentAsOf: latest.asOf,
    previousPeriod: previous.period, currentPeriod: latest.period,
    samePeriod: latest.period.start === previous.period.start && latest.period.end === previous.period.end,
    monthlySpending: delta('monthlySpending'), monthlySurplus: delta('monthlySurplus'),
    reserveShortfall: delta('reserveShortfall'), netWorth: delta('netWorth'), debt: delta('debt'),
    basis: 'Changes compare recorded household snapshots, not realised savings or investment returns. Missing amounts remain unknown. Recorded net worth can change with deposits, debts, new records or valuations.',
  };
}
