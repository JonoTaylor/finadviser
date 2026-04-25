/**
 * UK personal tax year runs 6 April → 5 April. Labelled "2024-25" for the
 * year starting 6 April 2024. This module is the single source of truth
 * for tax-year boundaries used across rental, MTD-IT, and reporting.
 */

import { ClientError } from '@/lib/errors';

export type TaxYearLabel = `${number}-${number}`;

export interface TaxYearRange {
  label: TaxYearLabel;
  startYear: number;
  startDate: string;
  endDate: string;
}

const LABEL_RE = /^(\d{4})-(\d{2})$/;

export function parseTaxYearLabel(label: string): number {
  const m = LABEL_RE.exec(label);
  if (!m) throw new ClientError(`Invalid tax year label: ${label} (expected YYYY-YY, e.g. 2024-25)`);
  const startYear = parseInt(m[1], 10);
  const endShort = parseInt(m[2], 10);
  const expectedEnd = (startYear + 1) % 100;
  if (endShort !== expectedEnd) {
    throw new ClientError(`Invalid tax year label: ${label} (end year must be ${String(expectedEnd).padStart(2, '0')})`);
  }
  return startYear;
}

export function taxYearRange(input: number | string): TaxYearRange {
  const startYear = typeof input === 'number' ? input : parseTaxYearLabel(input);
  const endYear = startYear + 1;
  const label = `${startYear}-${String(endYear % 100).padStart(2, '0')}` as TaxYearLabel;
  return {
    label,
    startYear,
    startDate: `${startYear}-04-06`,
    endDate: `${endYear}-04-05`,
  };
}

/**
 * UK tax-year boundaries are based on the UK calendar date, not UTC. Around
 * midnight (and during BST) UTC parts can disagree with the local date and
 * misattribute the tax year, so we read the date parts in Europe/London.
 */
function londonDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(date);
  const year = Number(parts.find(p => p.type === 'year')?.value);
  const month = Number(parts.find(p => p.type === 'month')?.value);
  const day = Number(parts.find(p => p.type === 'day')?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    throw new Error('Unable to derive Europe/London date parts');
  }
  return { year, month, day };
}

export function currentTaxYear(now: Date = new Date()): TaxYearRange {
  const { year, month, day } = londonDateParts(now);
  const beforeApril6 = month < 4 || (month === 4 && day < 6);
  return taxYearRange(beforeApril6 ? year - 1 : year);
}

export function taxYearForDate(isoDate: string): TaxYearRange {
  // Treat the input as a calendar date (no timezone math).
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new ClientError(`Invalid ISO date: ${isoDate} (expected YYYY-MM-DD)`);
  const year = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const day = parseInt(m[3], 10);
  const beforeApril6 = month < 4 || (month === 4 && day < 6);
  return taxYearRange(beforeApril6 ? year - 1 : year);
}
