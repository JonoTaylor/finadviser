import Decimal from 'decimal.js';

/**
 * UK BTL mortgage interest calculator.
 *
 * Splits a date range into sub-periods at each rate change in the rate
 * history and computes interest at each rate, then sums. Day-count
 * convention is Act/365 (each day's interest = principal × rate / 365),
 * the standard for UK residential mortgages — 366-day spans across a
 * leap year therefore charge slightly more than a flat annual rate.
 *
 * For interest-only mortgages the principal stays at `originalAmount`
 * for the whole range. Repayment-mortgage amortisation is intentionally
 * out of scope here — the structure is set up so that adding a
 * principal-balance schedule later is mechanical.
 */

export interface RateHistoryEntry {
  rate: string;          // numeric percent, e.g. "5.2500"
  effectiveDate: string; // ISO YYYY-MM-DD
}

export interface InterestPeriod {
  /** Half-open: [from, to). */
  from: string;
  to: string;
  rate: string;
  days: number;
  interest: string;
}

export interface InterestCalculation {
  /** Half-open range used for the calculation. */
  rangeFrom: string;
  rangeTo: string;
  totalDays: number;
  /** Days in the range where no rate was in effect (i.e. before the
   *  first rate-history entry). The user is missing rate data for these
   *  days and the interest cannot be computed for them. */
  uncoveredDays: number;
  totalInterest: string;
  periods: InterestPeriod[];
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

function parseUtcMidnight(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime();
}

function isoToDays(iso: string): number {
  return Math.round(parseUtcMidnight(iso) / MS_PER_DAY);
}

function daysToIso(days: number): string {
  const d = new Date(days * MS_PER_DAY);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Add 1 day to an ISO date. Used to convert an inclusive end date
 * (e.g. UK tax year's "5 April Y+1") into the half-open boundary the
 * calculator works in.
 */
export function nextDay(iso: string): string {
  return daysToIso(isoToDays(iso) + 1);
}

/**
 * Compute mortgage interest over a half-open date range [rangeFrom, rangeTo).
 *
 * Notes:
 * - rangeFrom is INCLUSIVE, rangeTo is EXCLUSIVE. To compute interest
 *   for the UK tax year (6 Apr Y → 5 Apr Y+1, both inclusive), pass
 *   `rangeFrom = '2024-04-06'`, `rangeTo = '2025-04-06'`.
 * - Rate history must have at least one entry on or before rangeFrom
 *   for the prefix of the range to be covered. Days with no rate are
 *   reported in `uncoveredDays` and contribute zero interest.
 * - For repayment mortgages this caller currently has to pass the same
 *   `principal` for the whole range — i.e. the interest-only assumption.
 *   Adding amortisation = swap `principal` for a per-day balance
 *   lookup; the period-stitching logic stays the same.
 */
export function computeInterestForRange(params: {
  principal: string;
  rangeFrom: string;
  rangeTo: string;
  rateHistory: RateHistoryEntry[];
}): InterestCalculation {
  const { principal, rangeFrom, rangeTo, rateHistory } = params;

  const principalD = new Decimal(principal);
  const rangeFromDays = isoToDays(rangeFrom);
  const rangeToDays = isoToDays(rangeTo);
  if (rangeToDays <= rangeFromDays) {
    return {
      rangeFrom,
      rangeTo,
      totalDays: 0,
      uncoveredDays: 0,
      totalInterest: '0.00',
      periods: [],
    };
  }

  // Sort ascending by effectiveDate; if duplicates, the later push wins
  // (last-write-wins semantics — the user can correct a wrong rate by
  // entering a new row with the same effective date).
  const sorted = [...rateHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));

  // Walk each rate's interval [effectiveDate, nextEffectiveDate) and
  // intersect with [rangeFrom, rangeTo). Anything before the first rate
  // counts as "uncovered" and is added to the diagnostic field but
  // contributes zero interest.
  const periods: InterestPeriod[] = [];
  let totalInterest = new Decimal(0);

  // Days before the first rate history entry — uncovered.
  let coveredFromDays = rangeFromDays;
  if (sorted.length === 0) {
    return {
      rangeFrom,
      rangeTo,
      totalDays: rangeToDays - rangeFromDays,
      uncoveredDays: rangeToDays - rangeFromDays,
      totalInterest: '0.00',
      periods: [],
    };
  }

  const firstRateDays = isoToDays(sorted[0].effectiveDate);
  if (firstRateDays > rangeFromDays) {
    coveredFromDays = Math.min(firstRateDays, rangeToDays);
  }
  const uncoveredDays = coveredFromDays - rangeFromDays;

  for (let i = 0; i < sorted.length; i++) {
    const rateStartDays = Math.max(isoToDays(sorted[i].effectiveDate), coveredFromDays);
    const nextRateDays =
      i < sorted.length - 1 ? isoToDays(sorted[i + 1].effectiveDate) : Number.POSITIVE_INFINITY;
    const rateEndDays = Math.min(nextRateDays, rangeToDays);

    if (rateEndDays <= rateStartDays) continue;

    const days = rateEndDays - rateStartDays;
    const rateD = new Decimal(sorted[i].rate);
    // interest = principal × (rate / 100) × (days / 365)
    const periodInterest = principalD
      .mul(rateD)
      .div(100)
      .mul(days)
      .div(DAYS_PER_YEAR);

    totalInterest = totalInterest.plus(periodInterest);

    periods.push({
      from: daysToIso(rateStartDays),
      to: daysToIso(rateEndDays),
      rate: sorted[i].rate,
      days,
      interest: periodInterest.toFixed(2),
    });
  }

  return {
    rangeFrom,
    rangeTo,
    totalDays: rangeToDays - rangeFromDays,
    uncoveredDays,
    totalInterest: totalInterest.toFixed(2),
    periods,
  };
}

/**
 * Slice a calculation into one entry per calendar month (last day of
 * the month, or last day of the range if the month exceeds it). Used
 * by the "Generate monthly entries" feature so each month gets a
 * single journal stamped on its last day with the correct sub-rate
 * interest. Months with zero interest (all uncovered) are omitted.
 */
export function monthlyBreakdown(calc: InterestCalculation): Array<{
  month: string; // YYYY-MM
  date: string;  // YYYY-MM-DD — last day of the month within range (used as the journal date)
  interest: string;
}> {
  const out: Array<{ month: string; date: string; interest: string }> = [];

  const fromDays = isoToDays(calc.rangeFrom);
  const toDaysExclusive = isoToDays(calc.rangeTo);

  let cursor = fromDays;
  while (cursor < toDaysExclusive) {
    const cursorIso = daysToIso(cursor);
    const yyyy = parseInt(cursorIso.slice(0, 4), 10);
    const mm = parseInt(cursorIso.slice(5, 7), 10);
    // First day of the *next* calendar month (UTC).
    const monthEndDays = isoToDays(
      `${mm === 12 ? yyyy + 1 : yyyy}-${String(mm === 12 ? 1 : mm + 1).padStart(2, '0')}-01`,
    );
    const segEnd = Math.min(monthEndDays, toDaysExclusive);

    let monthInterest = new Decimal(0);
    for (const p of calc.periods) {
      const pFrom = isoToDays(p.from);
      const pTo = isoToDays(p.to);
      const overlapFrom = Math.max(pFrom, cursor);
      const overlapTo = Math.min(pTo, segEnd);
      if (overlapTo <= overlapFrom) continue;
      const days = overlapTo - overlapFrom;
      // Recompute on the slice — avoids accumulating rounding from each period.
      const slice = new Decimal(p.interest)
        .div(p.days)
        .mul(days);
      monthInterest = monthInterest.plus(slice);
    }

    if (monthInterest.gt(0)) {
      const monthLabel = `${yyyy}-${String(mm).padStart(2, '0')}`;
      out.push({
        month: monthLabel,
        date: daysToIso(segEnd - 1), // last day of the segment, as journal date
        interest: monthInterest.toFixed(2),
      });
    }
    cursor = segEnd;
  }

  return out;
}
