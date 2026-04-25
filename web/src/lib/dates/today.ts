/**
 * Today's date as YYYY-MM-DD in the Europe/London timezone. Use this for
 * any UK-calendar comparison (e.g. "is this tenancy current?") instead of
 * `new Date().toISOString().slice(0, 10)`, which is UTC and slips by a day
 * around midnight (especially during BST).
 */
export function londonTodayIso(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value ?? '1970';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const d = parts.find(p => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}
