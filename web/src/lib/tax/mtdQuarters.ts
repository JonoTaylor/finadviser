/**
 * MTD-IT (Making Tax Digital for Income Tax) quarterly periods.
 *
 * Per HMRC's standard fiscal quarters for property income, each tax year is
 * split into four quarters running 6 Apr → 5 Jul, 6 Jul → 5 Oct, 6 Oct →
 * 5 Jan, 6 Jan → 5 Apr. Quarterly updates are due one calendar month + 7
 * days after the quarter end (i.e. 7 Aug / 7 Nov / 7 Feb / 7 May).
 *
 * Per Jane's brief:
 *   "you only have to declare your share of the quarterly gross income
 *    received from the tenants (without netting off any agent fees or any
 *    other costs). The rental expenses then only need to be included in
 *    total on the end of year return."
 *
 * Owners can elect calendar-month quarters instead — that's a future flag
 * on the property/owner record. Not implemented here yet.
 */

import { taxYearRange, type TaxYearRange } from './ukTaxYear';

export interface MtdQuarter {
  /** 1, 2, 3, or 4 within the tax year. */
  index: 1 | 2 | 3 | 4;
  /** Human label, e.g. 'Q1 2026-27 (6 Apr → 5 Jul 2026)'. */
  label: string;
  /** First day of the quarter (YYYY-MM-DD). */
  startDate: string;
  /** Last day of the quarter (YYYY-MM-DD), inclusive. */
  endDate: string;
  /**
   * Quarterly update deadline (YYYY-MM-DD). HMRC: one calendar month and
   * seven days after the quarter end (5 Jul → 7 Aug, 5 Oct → 7 Nov,
   * 5 Jan → 7 Feb, 5 Apr → 7 May).
   */
  submissionDeadline: string;
}

const Q_BOUNDS: ReadonlyArray<{ start: [m: number, d: number]; end: [m: number, d: number]; deadline: [m: number, d: number] }> = [
  // Q1: 6 Apr → 5 Jul, deadline 7 Aug
  { start: [4, 6],  end: [7, 5],   deadline: [8, 7]  },
  // Q2: 6 Jul → 5 Oct, deadline 7 Nov
  { start: [7, 6],  end: [10, 5],  deadline: [11, 7] },
  // Q3: 6 Oct → 5 Jan, deadline 7 Feb (end + deadline cross into next calendar year)
  { start: [10, 6], end: [1, 5],   deadline: [2, 7]  },
  // Q4: 6 Jan → 5 Apr, deadline 7 May (whole quarter is in next calendar year)
  { start: [1, 6],  end: [4, 5],   deadline: [5, 7]  },
];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

/**
 * Return the four MTD quarters for a UK tax year, in chronological order.
 *
 * Calendar-year mapping: Q1+Q2 sit in `startYear` (e.g. 2026 for tax year
 * 2026-27). Q3 starts in `startYear` and ends in `startYear + 1`. Q4 sits
 * entirely in `startYear + 1`. Deadlines always fall in the same calendar
 * year as the quarter's end date because the deadline is always one month
 * after the end and never crosses a year boundary itself.
 */
export function mtdQuartersForTaxYear(input: number | string | TaxYearRange): MtdQuarter[] {
  const range = typeof input === 'object' ? input : taxYearRange(input);
  const startYear = range.startYear;

  return Q_BOUNDS.map((b, i) => {
    const startCalYear = i < 3 ? startYear : startYear + 1;
    const endCalYear = b.end[0] >= b.start[0] ? startCalYear : startCalYear + 1;
    const startStr = ymd(startCalYear, b.start[0], b.start[1]);
    const endStr = ymd(endCalYear, b.end[0], b.end[1]);
    const deadlineStr = ymd(endCalYear, b.deadline[0], b.deadline[1]);
    const idx = (i + 1) as 1 | 2 | 3 | 4;
    return {
      index: idx,
      label: `Q${idx} ${range.label} (${startStr} → ${endStr})`,
      startDate: startStr,
      endDate: endStr,
      submissionDeadline: deadlineStr,
    };
  });
}

/**
 * Identify the quarter (within its tax year) that contains a given date.
 * Returns null if the date falls outside the standard tax-year boundaries
 * (shouldn't happen for ISO dates, but defensive).
 */
export function quarterForDate(isoDate: string): { taxYear: TaxYearRange; quarter: MtdQuarter } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const beforeApril6 = month < 4 || (month === 4 && day < 6);
  const range = taxYearRange(beforeApril6 ? year - 1 : year);
  const quarters = mtdQuartersForTaxYear(range);
  const target = ymd(year, month, day);
  const q = quarters.find(qq => qq.startDate <= target && target <= qq.endDate) ?? null;
  if (!q) return null;
  return { taxYear: range, quarter: q };
}
