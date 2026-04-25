/**
 * Expand tenancy contracts into a schedule of rent periods that fall within
 * a date range — used by the tax-year report to compute gross income from
 * the contract (the source of truth) rather than from per-receipt journals.
 *
 * Conventions:
 * - For monthly rent, the due date is the same day-of-month as the tenancy
 *   start_date (e.g. start 12 May → due on the 12th of each month).
 *   If the start day exceeds the month length (e.g. 31 → February), the
 *   due date falls on the last day of the month.
 * - For weekly / four-weekly, due dates step from start_date by 7 / 28 days.
 * - Quarterly steps by 3 months (same day-of-month rule).
 * - Annual steps by 12 months.
 * - A period's full rent is included if its due date falls within both the
 *   tenancy active range and the requested range.
 */

import Decimal from 'decimal.js';
import { ClientError } from '@/lib/errors';
import type { RentFrequency } from '@/lib/repos/tenancy.repo';

export type { RentFrequency };

export interface TenancyForSchedule {
  id: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: RentFrequency;
}

export interface ScheduleLine {
  tenancyId: number;
  tenantName: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function parseIso(d: string): Date {
  // Tenancy dates are stored as TEXT and only checked for presence by the
  // API, so a malformed date could otherwise silently produce an empty or
  // off-by-one schedule. Surface the bad input loudly as a 400.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
    throw new ClientError(`Invalid ISO date: ${d} (expected YYYY-MM-DD)`);
  }
  const date = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new ClientError(`Invalid ISO date: ${d}`);
  }
  return date;
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDaysUtc(d: Date, days: number): Date {
  return new Date(d.getTime() + days * ONE_DAY_MS);
}

function addMonthsKeepingDay(d: Date, months: number, anchorDay: number): Date {
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(anchorDay, lastDay)));
}

function nextDueDate(prev: Date, frequency: RentFrequency, anchorDay: number): Date {
  switch (frequency) {
    case 'weekly':
      return addDaysUtc(prev, 7);
    case 'four_weekly':
      return addDaysUtc(prev, 28);
    case 'monthly':
      return addMonthsKeepingDay(prev, 1, anchorDay);
    case 'quarterly':
      return addMonthsKeepingDay(prev, 3, anchorDay);
    case 'annual':
      return addMonthsKeepingDay(prev, 12, anchorDay);
  }
}

function periodEndFor(due: Date, frequency: RentFrequency, anchorDay: number): Date {
  // End is one day before the next due date.
  return addDaysUtc(nextDueDate(due, frequency, anchorDay), -1);
}

/**
 * Expand a single tenancy into the rent occurrences that fall within
 * [rangeStart, rangeEnd] (inclusive). The first occurrence is the
 * tenancy's start_date; subsequent occurrences step by frequency.
 *
 * A period is included only when its due date falls inside the requested
 * range AND inside the tenancy's active range.
 */
export function expandTenancy(
  tenancy: TenancyForSchedule,
  rangeStart: string,
  rangeEnd: string,
): ScheduleLine[] {
  if (tenancy.endDate && tenancy.endDate < rangeStart) return [];
  if (tenancy.startDate > rangeEnd) return [];

  const start = parseIso(tenancy.startDate);
  const end = tenancy.endDate ? parseIso(tenancy.endDate) : null;
  const rangeEndDate = parseIso(rangeEnd);
  const rangeStartDate = parseIso(rangeStart);
  const anchorDay = start.getUTCDate();

  const out: ScheduleLine[] = [];
  let due = new Date(start.getTime());

  // Safety bound: even weekly for 50 years is ~2600 iterations.
  for (let i = 0; i < 5000; i += 1) {
    if (due > rangeEndDate) break;
    if (end && due > end) break;

    if (due >= rangeStartDate) {
      const periodEndDate = periodEndFor(due, tenancy.rentFrequency, anchorDay);
      const periodEndCapped = end && periodEndDate > end ? end : periodEndDate;
      out.push({
        tenancyId: tenancy.id,
        tenantName: tenancy.tenantName,
        dueDate: toIso(due),
        periodStart: toIso(due),
        periodEnd: toIso(periodEndCapped),
        amount: new Decimal(tenancy.rentAmount).toFixed(2),
      });
    }

    due = nextDueDate(due, tenancy.rentFrequency, anchorDay);
  }

  return out;
}

export function expandTenancies(
  tenancies: TenancyForSchedule[],
  rangeStart: string,
  rangeEnd: string,
): ScheduleLine[] {
  const all = tenancies.flatMap(t => expandTenancy(t, rangeStart, rangeEnd));
  return all.sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0));
}

export function totalScheduled(lines: ScheduleLine[]): string {
  return lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0)).toFixed(2);
}
