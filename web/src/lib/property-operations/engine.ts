import Decimal from 'decimal.js';
import { expandTenancies, type ScheduleLine, type TenancyForSchedule } from '@/lib/properties/rent-schedule';
import { calendarDateSchema, type PropertyObligation, type PropertyOperationsData } from './types';

export interface OperationsProperty {
  id: number;
  name: string;
  valuation: string | null;
  valuationDate: string | null;
  mortgageDebt: string | null;
}
export interface PropertyReceipt {
  propertyId: number;
  date: string;
  /** Signed income: receipts positive, refunds negative. Transfers are excluded by the loader. */
  amount: string;
}
export interface PropertyJournalCoverage { propertyId: number; date: string }
export interface OperationsTenancy extends TenancyForSchedule { propertyId: number }
export interface UpcomingRent extends ScheduleLine { propertyId: number; propertyName: string }
export interface OperationsObligation extends PropertyObligation {
  propertyName: string;
  isOverdue: boolean;
  isDueSoon: boolean;
}
export interface PropertyOperatingSummary extends OperationsProperty {
  scheduledRent: string;
  recordedIncome: string | null;
  unreconciledRentGap: string | null;
  incomeEntryCount: number;
  coverage: { journalCount: number; firstDate: string | null; lastDate: string | null; completeness: 'unverified' };
  upcomingScheduledRent: string;
  loanToValuePercent: string | null;
  reserveTarget: string | null;
}
export interface PropertyOperationsSummary {
  asOf: string;
  comparison: { month: string; startDate: string; endDate: string };
  upcoming: { startDate: string; endDate: string; total: string; lines: UpcomingRent[] };
  properties: PropertyOperatingSummary[];
  obligations: OperationsObligation[];
  overdueCount: number;
  dueSoonCount: number;
  warnings: string[];
}

export function operationsDateRanges(asOf: string) {
  const valid = calendarDateSchema.parse(asOf);
  const day = new Date(`${valid}T00:00:00Z`);
  const iso = (date: Date) => date.toISOString().slice(0, 10);
  return {
    comparison: {
      month: iso(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1))).slice(0, 7),
      startDate: iso(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() - 1, 1))),
      endDate: iso(new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), 0))),
    },
    upcomingStart: valid,
    upcomingEnd: iso(new Date(day.getTime() + 29 * 86400000)),
  };
}

function amount(value: string): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error('Invalid recorded amount');
  return parsed;
}

export function classifyPropertyObligations(asOf: string, properties: Pick<OperationsProperty, 'id' | 'name'>[], data: PropertyOperationsData): OperationsObligation[] {
  const ranges = operationsDateRanges(asOf);
  const names = new Map(properties.map(row => [row.id, row.name]));
  return data.obligations.map(row => ({
    ...row,
    propertyName: names.get(row.propertyId) ?? 'Property no longer recorded',
    isOverdue: row.status === 'open' && row.dueDate < asOf,
    isDueSoon: row.status === 'open' && row.dueDate >= asOf && row.dueDate <= ranges.upcomingEnd,
  })).sort((a, b) => Number(a.status === 'completed') - Number(b.status === 'completed') || a.dueDate.localeCompare(b.dueDate) || a.id.localeCompare(b.id));
}

/** Compare contractual due dates with recorded property income; never infer tenant arrears. */
export function analyzePropertyOperations(input: {
  asOf: string;
  properties: OperationsProperty[];
  tenancies: OperationsTenancy[];
  receipts: PropertyReceipt[];
  journalCoverage: PropertyJournalCoverage[];
  data: PropertyOperationsData;
}): PropertyOperationsSummary {
  const ranges = operationsDateRanges(input.asOf);
  const upcomingLines: UpcomingRent[] = [];
  const properties = input.properties.map(property => {
    const tenancies = input.tenancies.filter(row => row.propertyId === property.id);
    // The existing schedule excludes an outgoing tenancy's handover date.
    for (const tenancy of tenancies) {
      calendarDateSchema.parse(tenancy.startDate);
      if (tenancy.endDate) calendarDateSchema.parse(tenancy.endDate);
      if (amount(tenancy.rentAmount).lt(0)) throw new Error('Invalid scheduled rent');
    }
    const scheduled = expandTenancies(tenancies, ranges.comparison.startDate, ranges.comparison.endDate);
    const upcoming = expandTenancies(tenancies, ranges.upcomingStart, ranges.upcomingEnd);
    upcomingLines.push(...upcoming.map(line => ({ ...line, propertyId: property.id, propertyName: property.name })));
    const receipts = input.receipts.filter(row => row.propertyId === property.id && row.date >= ranges.comparison.startDate && row.date <= ranges.comparison.endDate);
    const dates = [...new Set(input.journalCoverage.filter(row => row.propertyId === property.id && row.date >= ranges.comparison.startDate && row.date <= ranges.comparison.endDate).map(row => row.date))].sort();
    const scheduledRent = scheduled.reduce((sum, row) => sum.plus(row.amount), new Decimal(0));
    // An absent month stays unknown. A recorded expense-only month has zero recorded income,
    // but the coverage disclosure still makes clear that completeness is unverified.
    const recordedIncome = receipts.length || dates.length ? receipts.reduce((sum, row) => sum.plus(amount(row.amount)), new Decimal(0)) : null;
    const valuation = property.valuation === null ? null : amount(property.valuation);
    const debt = property.mortgageDebt === null ? null : amount(property.mortgageDebt);
    return {
      ...property,
      scheduledRent: scheduledRent.toFixed(2),
      recordedIncome: recordedIncome?.toFixed(2) ?? null,
      unreconciledRentGap: recordedIncome === null ? null : scheduledRent.minus(recordedIncome).toFixed(2),
      incomeEntryCount: receipts.length,
      coverage: { journalCount: input.journalCoverage.filter(row => row.propertyId === property.id && row.date >= ranges.comparison.startDate && row.date <= ranges.comparison.endDate).length, firstDate: dates[0] ?? null, lastDate: dates.at(-1) ?? null, completeness: 'unverified' as const },
      upcomingScheduledRent: upcoming.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)).toFixed(2),
      loanToValuePercent: valuation?.gt(0) && debt !== null ? debt.div(valuation).times(100).toFixed(1) : null,
      reserveTarget: input.data.reserveTargets.find(row => row.propertyId === property.id)?.targetAmount ?? null,
    };
  });
  const obligations = classifyPropertyObligations(input.asOf, input.properties, input.data);
  upcomingLines.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.propertyId - b.propertyId || a.tenancyId - b.tenancyId);
  return {
    asOf: input.asOf,
    comparison: ranges.comparison,
    upcoming: { startDate: ranges.upcomingStart, endDate: ranges.upcomingEnd, total: upcomingLines.reduce((sum, row) => sum.plus(row.amount), new Decimal(0)).toFixed(2), lines: upcomingLines },
    properties,
    obligations,
    overdueCount: obligations.filter(row => row.isOverdue).length,
    dueSoonCount: obligations.filter(row => row.isDueSoon).length,
    warnings: [
      'Recorded property INCOME entries are a receipt proxy and may include other income. Transfers are excluded and refunds reduce income.',
      'An unreconciled rent gap is scheduled rent less recorded property income. Timing, refunds, other income and incomplete imports can all change it; receipts are not allocated to tenants, so it is not tenant arrears.',
      'Journal date coverage does not prove a complete month. Missing months remain unknown.',
      'Obligation dates and reserve targets are your own planning assumptions. Dates have not been checked against legal requirements and reserve targets do not add cash to your accounts.',
    ],
  };
}
