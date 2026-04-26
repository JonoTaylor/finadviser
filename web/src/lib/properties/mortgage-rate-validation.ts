/**
 * Shared validators for mortgage rate inputs. Used by both the rate
 * POST and PATCH routes so the API enforces the same constraints in
 * both write paths and never relies on the DB to throw a 500 for a bad
 * payload.
 *
 * Constraints:
 * - rate: must fit `mortgage_rate_history.rate numeric(6,4)` — max 6
 *   significant digits, up to 4 after the decimal, 0 ≤ rate ≤ 99.9999.
 * - effectiveDate: ISO YYYY-MM-DD AND a real calendar date (so e.g.
 *   "2024-99-99" or "2024-02-30" are rejected at the boundary, not
 *   later by NaN-flavoured date math).
 */

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d+)?$/;
const RATE_MAX = 99.9999;
const RATE_SCALE = 4;
const RATE_PRECISION = 6;

export function isValidRate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!RATE_RE.test(value)) return false;

  const [whole = '', fraction = ''] = value.split('.');
  // Strip leading zeros for the precision check ("00.5" should count as 1
  // significant digit + 1 fractional, not 2 + 1).
  const significant = `${whole.replace(/^0+(?=\d)/, '')}${fraction}`;
  if (fraction.length > RATE_SCALE) return false;
  if (significant.length > RATE_PRECISION) return false;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return false;
  if (numeric < 0 || numeric > RATE_MAX) return false;

  return true;
}

export function isValidCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  if (!ISO_DATE_RE.test(value)) return false;
  const [yearText, monthText, dayText] = value.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  // Round-trip via Date.UTC: an impossible day like 2024-02-30 will be
  // normalised by Date and the parts won't match what we put in.
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const RATE_VALIDATION_MESSAGE =
  'rate must be a numeric percent between 0 and 99.9999, with at most 4 decimal places';
export const DATE_VALIDATION_MESSAGE =
  'effectiveDate must be a real YYYY-MM-DD calendar date';
