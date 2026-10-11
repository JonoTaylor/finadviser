import Decimal from 'decimal.js';
import { expandTenancies } from '@/lib/properties/rent-schedule';
import { taxYearRange } from '@/lib/tax/ukTaxYear';
import type {
  AllocationRuleRow,
  DbState,
  LedgerLine,
  OwnershipRow,
  OwnerTotals,
  PropertyTotals,
  TenancyRow,
  Totals,
} from './types';

/**
 * Owner tax-year totals, computed the way the app's own tax report does it.
 * This is a line-for-line mirror of:
 *
 *   rental-report.repo.ts   getTaxYearReport (rent from the tenancy schedule,
 *                           INCOME-account journals as other income, EXPENSE
 *                           debits as expenses, the system 'Mortgage Interest'
 *                           account kept separate, transfers excluded, the
 *                           allocation factor applied PER LINE and rounded to
 *                           pence before summing)
 *   rental-report.repo.ts   resolveAllocationPct
 *   owner-report.repo.ts    getTaxYearReport (sum over the owner's properties)
 *
 * The rent schedule itself is not re-implemented: expandTenancies is the
 * same function the report calls. If the report's arithmetic changes, this
 * file must change with it.
 */

const MORTGAGE_INTEREST_ACCOUNT_NAME = 'Mortgage Interest';

export function resolveAllocationPct(
  propertyId: number,
  ownerId: number,
  rules: AllocationRuleRow[],
  ownership: OwnershipRow[],
): Decimal {
  const rule = rules.find(r => r.propertyId === propertyId && r.ownerId === ownerId && r.expenseType === 'all');
  if (rule) return new Decimal(rule.allocationPct);

  const forProperty = ownership.filter(o => o.propertyId === propertyId);
  const belongs = forProperty.filter(o => o.ownerId === ownerId).length;
  if (forProperty.length === 0 || belongs === 0) {
    throw new Error(`Owner ${ownerId} is not an owner of property ${propertyId}`);
  }
  return new Decimal(100).div(forProperty.length);
}

function share(amount: Decimal.Value, factor: Decimal): Decimal {
  // Same rounding as applyShareToIncome / applyShareToExpenses.
  return new Decimal(new Decimal(amount).mul(factor).toFixed(2));
}

function propertyTotals(params: {
  propertyId: number;
  propertyName: string;
  factor: Decimal;
  allocationPct: Decimal;
  tenancies: TenancyRow[];
  lines: LedgerLine[];
  startDate: string;
  endDate: string;
}): PropertyTotals {
  const { propertyId, propertyName, factor, allocationPct, tenancies, lines, startDate, endDate } = params;

  const schedule = expandTenancies(
    tenancies.map(t => ({
      id: t.id,
      tenantName: t.tenantName,
      startDate: t.startDate,
      endDate: t.endDate,
      rentAmount: t.rentAmount,
      rentFrequency: t.rentFrequency,
    })),
    startDate,
    endDate,
  );

  let scheduledRent = new Decimal(0);
  for (const s of schedule) scheduledRent = scheduledRent.plus(share(s.amount, factor));

  let otherIncome = new Decimal(0);
  let expenses = new Decimal(0);
  let interest = new Decimal(0);

  for (const l of lines) {
    if (l.propertyId !== propertyId) continue;
    if (l.date < startDate || l.date > endDate) continue;
    if (l.isTransfer) continue;

    const raw = new Decimal(l.amount);
    if (l.accountType === 'INCOME') {
      // Income posts as a credit (negative); flip so positive = received.
      otherIncome = otherIncome.plus(share(raw.neg().toFixed(2), factor));
      continue;
    }
    const allocated = share(raw.toFixed(2), factor);
    if (l.accountName === MORTGAGE_INTEREST_ACCOUNT_NAME && l.accountIsSystem) {
      interest = interest.plus(allocated);
    } else {
      expenses = expenses.plus(allocated);
    }
  }

  const gross = scheduledRent.plus(otherIncome);
  return {
    propertyId,
    propertyName,
    allocationPct: allocationPct.toFixed(4),
    grossIncome: gross.toFixed(2),
    totalExpenses: expenses.toFixed(2),
    mortgageInterest: interest.toFixed(2),
    netBeforeMortgageRelief: gross.minus(expenses).toFixed(2),
    scheduledRent: scheduledRent.toFixed(2),
    otherIncome: otherIncome.toFixed(2),
    scheduledRentLines: schedule.length,
  };
}

/**
 * Tax-year totals at the owner's share, summed over every property the owner
 * has a stake in (same scope as ownerReportRepo.getTaxYearReport).
 * `state.taggedLines` must cover all of those properties' journals for the
 * year; lines outside the year are ignored here.
 */
export function computeOwnerTotals(params: {
  ownerId: number;
  taxYear: string;
  state: Pick<DbState, 'owners' | 'properties' | 'ownership' | 'allocationRules' | 'tenancies' | 'taggedLines'>;
}): OwnerTotals {
  const { ownerId, state } = params;
  const range = taxYearRange(params.taxYear);
  const owner = state.owners.find(o => o.id === ownerId);
  if (!owner) throw new Error(`Owner ${ownerId} not found`);

  const owned = state.properties
    .filter(p => state.ownership.some(o => o.ownerId === ownerId && o.propertyId === p.id))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const perProperty: PropertyTotals[] = owned.map(p => {
    const allocationPct = resolveAllocationPct(p.id, ownerId, state.allocationRules, state.ownership);
    return propertyTotals({
      propertyId: p.id,
      propertyName: p.name,
      factor: allocationPct.div(100),
      allocationPct,
      tenancies: state.tenancies.filter(t => t.propertyId === p.id),
      lines: state.taggedLines,
      startDate: range.startDate,
      endDate: range.endDate,
    });
  });

  let gross = new Decimal(0);
  let expenses = new Decimal(0);
  let interest = new Decimal(0);
  for (const p of perProperty) {
    gross = gross.plus(p.grossIncome);
    expenses = expenses.plus(p.totalExpenses);
    interest = interest.plus(p.mortgageInterest);
  }
  const combined: Totals = {
    grossIncome: gross.toFixed(2),
    totalExpenses: expenses.toFixed(2),
    mortgageInterest: interest.toFixed(2),
    netBeforeMortgageRelief: gross.minus(expenses).toFixed(2),
  };

  return {
    ownerId,
    ownerName: owner.name,
    taxYear: range.label,
    startDate: range.startDate,
    endDate: range.endDate,
    properties: perProperty,
    combined,
  };
}

export function totalsEqual(a: Totals, b: Totals): boolean {
  return (
    a.grossIncome === b.grossIncome &&
    a.totalExpenses === b.totalExpenses &&
    a.mortgageInterest === b.mortgageInterest &&
    a.netBeforeMortgageRelief === b.netBeforeMortgageRelief
  );
}
