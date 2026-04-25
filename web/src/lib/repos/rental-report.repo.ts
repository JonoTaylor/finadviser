import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';
import { ClientError } from '@/lib/errors';
import { tenancyRepo } from './tenancy.repo';
import { expandTenancies, totalScheduled, type ScheduleLine } from '@/lib/properties/rent-schedule';

export interface RentalExpenseLine {
  bookEntryId: number;
  journalId: number;
  date: string;
  description: string;
  reference: string | null;
  category: string | null;
  account: string;
  /**
   * Signed amount as a string (decimal). Expense debits are positive,
   * credits (refunds / reversals) are negative — preserved so contra
   * entries reduce the bucket total when summed.
   */
  amount: string;
}

export interface RentalIncomeLine {
  bookEntryId?: number;
  journalId?: number;
  tenancyId?: number;
  tenantName?: string;
  source: 'tenancy_schedule' | 'journal';
  date: string;
  /** Period covered by this rent posting; only set for schedule lines. */
  periodStart?: string;
  periodEnd?: string;
  description?: string;
  account?: string;
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
  /** Income from tenancy contracts; the canonical source for rent. */
  income: RentalIncomeLine[];
  /**
   * Manual INCOME-account journal entries tagged with this property
   * (e.g. one-off fees, deposit retention, laundry). Reported separately
   * so accountants can see them without conflating with contract rent.
   */
  otherIncome: RentalIncomeLine[];
  expenses: RentalExpenseLine[];
  mortgageInterest: RentalExpenseLine[];
  totals: RentalReportTotals;
  /**
   * When ownerId is supplied, this is set and the line items above have
   * already had the allocation factor applied per line. Sum-of-lines
   * matches the totals exactly so the report always "adds up".
   */
  totalsForOwner: RentalReportTotals | null;
}

const MORTGAGE_INTEREST_ACCOUNT_NAME = 'Mortgage Interest';

export const rentalReportRepo = {
  /**
   * Build a tax-year report for one property.
   *
   * Income:    derived from tenancy contracts via expandTenancies(). The
   *            user records the contractual rent and dates; we don't
   *            require per-receipt journal entry.
   * Other income: INCOME-account journal entries tagged with this
   *            property — laundry, deposit retention, etc. Returned as
   *            a separate bucket so it isn't silently dropped.
   * Expenses:  EXPENSE-account debits, sign-preserved so refunds reduce
   *            totals. Excludes the protected system 'Mortgage Interest'
   *            account.
   * Mortgage interest: reported separately because under S.24 it gets
   *            basic-rate relief only, not full deduction. Identified by
   *            name AND is_system = true so a user-renamed account can't
   *            shadow the protected one.
   *
   * When ownerId is supplied, allocation is applied per-line at Decimal
   * precision and totalsForOwner is the sum of the rounded lines (so the
   * report visually adds up — no display-vs-total drift from rounding).
   */
  async getTaxYearReport(params: {
    propertyId: number;
    startDate: string;
    endDate: string;
    ownerId?: number | null;
  }): Promise<RentalReportResult> {
    const { propertyId, startDate, endDate, ownerId = null } = params;

    const tenancies = await tenancyRepo.listByProperty(propertyId);
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

    const incomeLines: RentalIncomeLine[] = schedule.map(scheduleLineToIncome);
    const { otherIncome, expenses, mortgageInterest } =
      await fetchPropertyJournalLines(propertyId, startDate, endDate);

    let allocationPct = new Decimal(100);
    let totalsForOwner: RentalReportTotals | null = null;

    if (ownerId !== null) {
      allocationPct = await resolveAllocationPct(propertyId, ownerId);
      const factor = allocationPct.div(100);

      // Apply allocation per line at Decimal precision, rounded to pence.
      // Mutating in place keeps the response shape simple.
      applyShareToIncome(incomeLines, factor);
      applyShareToIncome(otherIncome, factor);
      applyShareToExpenses(expenses, factor);
      applyShareToExpenses(mortgageInterest, factor);
    }

    const grossIncome = sumIncome(incomeLines).plus(sumIncome(otherIncome));
    const totalExpenses = sumExpenses(expenses);
    const mortgageInterestTotal = sumExpenses(mortgageInterest);

    const totals: RentalReportTotals = {
      grossIncome: grossIncome.toFixed(2),
      totalExpenses: totalExpenses.toFixed(2),
      mortgageInterest: mortgageInterestTotal.toFixed(2),
      netBeforeMortgageRelief: grossIncome.minus(totalExpenses).toFixed(2),
    };

    if (ownerId !== null) {
      // totalsForOwner is the sum of the already-allocated lines, not a
      // separate factor multiplication, so display always reconciles.
      totalsForOwner = totals;
    }

    return {
      propertyId,
      startDate,
      endDate,
      ownerId,
      allocationPct: allocationPct.toFixed(4),
      income: incomeLines,
      otherIncome,
      expenses,
      mortgageInterest,
      totals,
      totalsForOwner,
    };
  },
};

function scheduleLineToIncome(s: ScheduleLine): RentalIncomeLine {
  return {
    source: 'tenancy_schedule',
    tenancyId: s.tenancyId,
    tenantName: s.tenantName,
    date: s.dueDate,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    amount: s.amount,
  };
}

function sumIncome(lines: RentalIncomeLine[]): Decimal {
  return lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
}

function sumExpenses(lines: RentalExpenseLine[]): Decimal {
  return lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));
}

function applyShareToIncome(lines: RentalIncomeLine[], factor: Decimal): void {
  for (const l of lines) {
    l.amount = new Decimal(l.amount).mul(factor).toFixed(2);
  }
}

function applyShareToExpenses(lines: RentalExpenseLine[], factor: Decimal): void {
  for (const l of lines) {
    l.amount = new Decimal(l.amount).mul(factor).toFixed(2);
  }
}

async function fetchPropertyJournalLines(
  propertyId: number,
  startDate: string,
  endDate: string,
): Promise<{
  otherIncome: RentalIncomeLine[];
  expenses: RentalExpenseLine[];
  mortgageInterest: RentalExpenseLine[];
}> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT be.id           AS book_entry_id,
           je.id           AS journal_id,
           je.date         AS date,
           je.description  AS description,
           je.reference    AS reference,
           c.name          AS category,
           a.name          AS account,
           a.account_type  AS account_type,
           a.is_system     AS account_is_system,
           be.amount::numeric AS amount
    FROM journal_entries je
    JOIN book_entries be ON be.journal_entry_id = je.id
    JOIN accounts a      ON a.id = be.account_id
    LEFT JOIN categories c ON c.id = je.category_id
    WHERE je.property_id = ${propertyId}
      AND je.date >= ${startDate}
      AND je.date <= ${endDate}
      AND a.account_type IN ('INCOME', 'EXPENSE')
    ORDER BY je.date ASC, je.id ASC, be.id ASC
  `);

  const otherIncome: RentalIncomeLine[] = [];
  const expenses: RentalExpenseLine[] = [];
  const mortgageInterest: RentalExpenseLine[] = [];

  for (const r of rows.rows as Array<Record<string, unknown>>) {
    const raw = new Decimal((r.amount as string | number).toString());
    const accountType = r.account_type as string;
    const account = r.account as string;
    const isSystem = Boolean(r.account_is_system);

    if (accountType === 'INCOME') {
      // Income posts as a credit (negative); flip so positive = received,
      // negative = refund.
      otherIncome.push({
        source: 'journal',
        bookEntryId: r.book_entry_id as number,
        journalId: r.journal_id as number,
        date: r.date as string,
        description: r.description as string,
        account,
        amount: raw.neg().toFixed(2),
      });
      continue;
    }

    const expenseLine: RentalExpenseLine = {
      bookEntryId: r.book_entry_id as number,
      journalId: r.journal_id as number,
      date: r.date as string,
      description: r.description as string,
      reference: (r.reference as string | null) ?? null,
      category: (r.category as string | null) ?? null,
      account,
      amount: raw.toFixed(2),
    };

    if (account === MORTGAGE_INTEREST_ACCOUNT_NAME && isSystem) {
      mortgageInterest.push(expenseLine);
    } else {
      expenses.push(expenseLine);
    }
  }

  return { otherIncome, expenses, mortgageInterest };
}

export async function resolveAllocationPct(propertyId: number, ownerId: number): Promise<Decimal> {
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
    throw new ClientError(`Owner ${ownerId} is not an owner of property ${propertyId}`);
  }
  return new Decimal(100).div(n);
}

// Re-export for callers that want a typed handle on the lines.
export { totalScheduled };
export type { ScheduleLine };
