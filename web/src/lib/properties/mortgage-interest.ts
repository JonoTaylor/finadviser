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

/**
 * Outstanding-principal at a given date. Each entry is taken as the
 * principal in effect FROM `effectiveDate` until the next entry (or
 * forever if it's the last). The schedule is expected to be sorted
 * ascending by effectiveDate; duplicate dates use last-wins.
 *
 * Used by the BTL interest calculator to model repayment-mortgage
 * amortisation: callers pass the schedule reconstructed from
 * `journal_entries`-derived principal payments, and the calculator
 * computes interest at the in-effect principal for each day.
 */
export interface BalanceScheduleEntry {
  principal: string;
  effectiveDate: string; // ISO YYYY-MM-DD
}

export interface InterestPeriod {
  /** Half-open: [from, to). */
  from: string;
  to: string;
  rate: string;
  /** Principal in effect for this period. Today this is the same for
   *  every period (interest-only fixed-principal); the field is kept
   *  per-period so amortisation can vary it later without changing
   *  monthlyBreakdown's signature. */
  principal: string;
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
 * - Principal: pass either a single fixed `principal` (interest-only
 *   semantics, or "no balance history available, use a placeholder")
 *   OR a `balanceSchedule` (repayment mortgage — outstanding balance
 *   reduces over time). When BOTH are passed, balanceSchedule wins
 *   and `principal` is ignored. When NEITHER is passed, we throw -
 *   the caller has to make an explicit choice between the two
 *   modes so we don't silently return zero interest.
 */
export function computeInterestForRange(params: {
  principal?: string;
  balanceSchedule?: BalanceScheduleEntry[];
  rangeFrom: string;
  rangeTo: string;
  rateHistory: RateHistoryEntry[];
}): InterestCalculation {
  const { principal, balanceSchedule, rangeFrom, rangeTo, rateHistory } = params;

  if (principal === undefined && (!balanceSchedule || balanceSchedule.length === 0)) {
    throw new Error(
      'computeInterestForRange: must pass either `principal` (fixed) or a non-empty `balanceSchedule`',
    );
  }

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

  // Sort rate history ascending; last-write-wins on duplicate dates.
  const sortedRates = [...rateHistory].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  if (sortedRates.length === 0) {
    return {
      rangeFrom,
      rangeTo,
      totalDays: rangeToDays - rangeFromDays,
      uncoveredDays: rangeToDays - rangeFromDays,
      totalInterest: '0.00',
      periods: [],
    };
  }

  // Build the principal-lookup function. When a balanceSchedule is
  // provided we look up the in-effect principal for each sub-period;
  // otherwise the fixed `principal` is used everywhere.
  const sortedSchedule: BalanceScheduleEntry[] = balanceSchedule
    ? [...balanceSchedule].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate))
    : [];
  const scheduleEffectiveDays = sortedSchedule.map(s => isoToDays(s.effectiveDate));

  function principalAtDay(day: number): Decimal {
    if (sortedSchedule.length === 0) return new Decimal(principal!);
    // Find the latest schedule entry with effectiveDate <= day.
    let chosen = sortedSchedule[0];
    for (let j = 0; j < sortedSchedule.length; j++) {
      if (scheduleEffectiveDays[j] <= day) chosen = sortedSchedule[j];
      else break;
    }
    return new Decimal(chosen.principal);
  }

  // Days before the first rate history entry — uncovered.
  let coveredFromDays = rangeFromDays;
  const firstRateDays = isoToDays(sortedRates[0].effectiveDate);
  if (firstRateDays > rangeFromDays) {
    coveredFromDays = Math.min(firstRateDays, rangeToDays);
  }
  const uncoveredDays = coveredFromDays - rangeFromDays;

  // Build the union of break points: rate-change dates + balance-
  // schedule effectiveDates (clipped to the range, deduped, sorted).
  // Each adjacent pair is a sub-period over which both rate and
  // principal are constant.
  const breakpoints = new Set<number>();
  breakpoints.add(coveredFromDays);
  breakpoints.add(rangeToDays);
  for (let i = 0; i < sortedRates.length; i++) {
    const d = isoToDays(sortedRates[i].effectiveDate);
    if (d > coveredFromDays && d < rangeToDays) breakpoints.add(d);
  }
  for (const d of scheduleEffectiveDays) {
    if (d > coveredFromDays && d < rangeToDays) breakpoints.add(d);
  }
  const sortedBreakpoints = Array.from(breakpoints).sort((a, b) => a - b);

  const periods: InterestPeriod[] = [];
  let totalInterest = new Decimal(0);

  for (let i = 0; i < sortedBreakpoints.length - 1; i++) {
    const segStart = sortedBreakpoints[i];
    const segEnd = sortedBreakpoints[i + 1];
    if (segEnd <= segStart) continue;
    const days = segEnd - segStart;

    // Find the rate in effect at segStart. The rate-history sort
    // guarantees the latest entry with effectiveDate <= segStart wins.
    let rateEntry: RateHistoryEntry | null = null;
    for (let j = 0; j < sortedRates.length; j++) {
      if (isoToDays(sortedRates[j].effectiveDate) <= segStart) rateEntry = sortedRates[j];
      else break;
    }
    if (!rateEntry) continue; // entirely uncovered prefix

    const principalD = principalAtDay(segStart);
    const rateD = new Decimal(rateEntry.rate);
    const periodInterest = principalD
      .mul(rateD)
      .div(100)
      .mul(days)
      .div(DAYS_PER_YEAR);

    totalInterest = totalInterest.plus(periodInterest);

    periods.push({
      from: daysToIso(segStart),
      to: daysToIso(segEnd),
      rate: rateEntry.rate,
      principal: principalD.toFixed(2),
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
 * Slice a calculation into one entry per calendar month, dated to the
 * last day of that month within the range (or the last day of the
 * range when it ends mid-month). Returned as the `months` field of
 * the per-mortgage computed-interest API response so the UI can show
 * a month-by-month preview of the year. This function does NOT
 * generate journal entries — that's intentionally out of scope for
 * the current calculator (would double-count once bank statements are
 * imported). Months with zero interest (all uncovered) are omitted.
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
      // Recompute the slice from principal × rate × days / 365 directly,
      // not from p.interest / p.days × days. The latter would introduce
      // cumulative rounding error since p.interest is already rounded
      // to 2dp for display.
      const slice = new Decimal(p.principal)
        .mul(p.rate)
        .div(100)
        .mul(days)
        .div(DAYS_PER_YEAR);
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
