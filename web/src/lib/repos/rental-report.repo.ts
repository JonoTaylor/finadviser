import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';
import { tenancyRepo } from './tenancy.repo';
import { expandTenancies, totalScheduled, type RentFrequency, type ScheduleLine } from '@/lib/properties/rent-schedule';

export interface RentalExpenseLine {
  journalId: number;
  date: string;
  description: string;
  reference: string | null;
  category: string | null;
  account: string;
  amount: string;
}

export interface RentalIncomeLine {
  tenancyId: number;
  tenantName: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
}

export interface RentalReportTotals {
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
  netBeforeMortgageRelief: string;
}

export interface RentalReportResult {
  propertyId: number;
  startDate: string;
  endDate: string;
  ownerId: number | null;
  allocationPct: string;
  income: RentalIncomeLine[];
  incomeSource: 'tenancy_schedule';
  expenses: RentalExpenseLine[];
  mortgageInterest: RentalExpenseLine[];
  totals: RentalReportTotals;
  totalsForOwner: RentalReportTotals | null;
}

const MORTGAGE_INTEREST_ACCOUNT = 'Mortgage Interest';

interface TenancyRow {
  id: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
  rentFrequency: string;
}

export const rentalReportRepo = {
  /**
   * Build a tax-year report for one property.
   *
   * Income:    derived from tenancy contracts (start/end/rent/frequency) —
   *            the user told us the contractual rent and assured it was
   *            consistently received, so we don't require per-receipt entry.
   * Expenses:  debits on EXPENSE accounts (excluding 'Mortgage Interest')
   *            on journals tagged with this property_id.
   * Mortgage interest: same shape, isolated, so accountants can apply S.24.
   *
   * Optional ownerId applies the expense_allocation_rules share.
   */
  async getTaxYearReport(params: {
    propertyId: number;
    startDate: string;
    endDate: string;
    ownerId?: number | null;
  }): Promise<RentalReportResult> {
    const { propertyId, startDate, endDate, ownerId = null } = params;

    const tenancies = (await tenancyRepo.listByProperty(propertyId)) as TenancyRow[];
    const schedule = expandTenancies(
      tenancies.map(t => ({
        id: t.id,
        tenantName: t.tenantName,
        startDate: t.startDate,
        endDate: t.endDate,
        rentAmount: t.rentAmount,
        rentFrequency: t.rentFrequency as RentFrequency,
      })),
      startDate,
      endDate,
    );

    const { expenses, mortgageInterest } = await fetchPropertyExpenses(propertyId, startDate, endDate);

    const grossIncome = new Decimal(totalScheduled(schedule));
    const totalExpenses = expenses.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
    const mortgageInterestTotal = mortgageInterest.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));

    const totals: RentalReportTotals = {
      grossIncome: grossIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      mortgageInterest: mortgageInterestTotal.toFixed(2),
      netBeforeMortgageRelief: grossIncome.minus(totalExpenses).toFixed(2),
    };

    let allocationPct = new Decimal(100);
    let totalsForOwner: RentalReportTotals | null = null;

    if (ownerId !== null) {
      allocationPct = await resolveAllocationPct(propertyId, ownerId);
      const factor = allocationPct.div(100);
      totalsForOwner = {
        grossIncome: grossIncome.mul(factor).toFixed(2),
        totalExpenses: totalExpenses.mul(factor).toFixed(2),
        mortgageInterest: mortgageInterestTotal.mul(factor).toFixed(2),
        netBeforeMortgageRelief: grossIncome.minus(totalExpenses).mul(factor).toFixed(2),
      };
    }

    return {
      propertyId,
      startDate,
      endDate,
      ownerId,
      allocationPct: allocationPct.toFixed(4),
      income: schedule as RentalIncomeLine[],
      incomeSource: 'tenancy_schedule',
      expenses,
      mortgageInterest,
      totals,
      totalsForOwner,
    };
  },
};

async function fetchPropertyExpenses(
  propertyId: number,
  startDate: string,
  endDate: string,
): Promise<{ expenses: RentalExpenseLine[]; mortgageInterest: RentalExpenseLine[] }> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT je.id           AS journal_id,
           je.date         AS date,
           je.description  AS description,
           je.reference    AS reference,
           c.name          AS category,
           a.name          AS account,
           be.amount::numeric AS amount
    FROM journal_entries je
    JOIN book_entries be ON be.journal_entry_id = je.id
    JOIN accounts a      ON a.id = be.account_id
    LEFT JOIN categories c ON c.id = je.category_id
    WHERE je.property_id = ${propertyId}
      AND je.date >= ${startDate}
      AND je.date <= ${endDate}
      AND a.account_type = 'EXPENSE'
    ORDER BY je.date ASC, je.id ASC
  `);

  const expenses: RentalExpenseLine[] = [];
  const mortgageInterest: RentalExpenseLine[] = [];

  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const amount = new Decimal((r.amount as string | number).toString()).abs().toFixed(2);
    const account = r.account as string;
    const line: RentalExpenseLine = {
      journalId: r.journal_id as number,
      date: r.date as string,
      description: r.description as string,
      reference: (r.reference as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      account,
      amount,
    };
    if (account === MORTGAGE_INTEREST_ACCOUNT) {
      mortgageInterest.push(line);
    } else {
      expenses.push(line);
    }
  }

  return { expenses, mortgageInterest };
}

async function resolveAllocationPct(propertyId: number, ownerId: number): Promise<Decimal> {
  const db = getDb();

  const ruleRows = await db.execute(sql`
    SELECT allocation_pct::numeric AS pct
    FROM expense_allocation_rules
    WHERE property_id = ${propertyId}
      AND owner_id    = ${ownerId}
      AND expense_type = 'all'
    LIMIT 1
  `);
  const rulePct = ruleRows.rows[0]?.pct;
  if (rulePct !== undefined && rulePct !== null) {
    return new Decimal(rulePct.toString());
  }

  // Fall back to equal split across all owners of the property.
  const ownerRows = await db.execute(sql`
    SELECT COUNT(*)::int AS n,
           SUM(CASE WHEN owner_id = ${ownerId} THEN 1 ELSE 0 END)::int AS belongs
    FROM property_ownership
    WHERE property_id = ${propertyId}
  `);
  const n = (ownerRows.rows[0]?.n as number) ?? 0;
  const belongs = (ownerRows.rows[0]?.belongs as number) ?? 0;
  if (n === 0 || belongs === 0) {
    throw new Error(`Owner ${ownerId} is not an owner of property ${propertyId}`);
  }
  return new Decimal(100).div(n);
}

// Re-export for callers that want a typed handle on the lines.
export type { ScheduleLine };
