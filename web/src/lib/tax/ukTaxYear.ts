/**
 * UK personal tax year runs 6 April → 5 April. Labelled "2024-25" for the
 * year starting 6 April 2024. This module is the single source of truth
 * for tax-year boundaries used across rental, MTD-IT, and reporting.
 */

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
  if (!m) throw new Error(`Invalid tax year label: ${label} (expected YYYY-YY, e.g. 2024-25)`);
  const startYear = parseInt(m[1], 10);
  const endShort = parseInt(m[2], 10);
  const expectedEnd = (startYear + 1) % 100;
  if (endShort !== expectedEnd) {
    throw new Error(`Invalid tax year label: ${label} (end year must be ${String(expectedEnd).padStart(2, '0')})`);
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

export function currentTaxYear(now: Date = new Date()): TaxYearRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const day = now.getUTCDate();
  const beforeApril6 = month < 4 || (month === 4 && day < 6);
  return taxYearRange(beforeApril6 ? year - 1 : year);
}

export function taxYearForDate(isoDate: string): TaxYearRange {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid ISO date: ${isoDate}`);
  return currentTaxYear(d);
}
