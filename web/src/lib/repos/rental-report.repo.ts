import { sql } from 'drizzle-orm';
import Decimal from 'decimal.js';
import { getDb } from '@/lib/db';

export interface RentalReportLine {
  journalId: number;
  date: string;
  description: string;
  reference: string | null;
  category: string | null;
  account: string;
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
  income: RentalReportLine[];
  expenses: RentalReportLine[];
  mortgageInterest: RentalReportLine[];
  totals: RentalReportTotals;
  totalsForOwner: RentalReportTotals | null;
}

const MORTGAGE_INTEREST_ACCOUNT = 'Mortgage Interest';

export const rentalReportRepo = {
  /**
   * Build a tax-year report for one property.
   *
   * Income:    credits (negative book entries) on INCOME accounts where the
   *            journal is tagged with this property_id.
   * Expenses:  debits (positive) on EXPENSE accounts, excluding the
   *            'Mortgage Interest' account (reported separately because
   *            interest gets restricted basic-rate relief, not full deduction).
   * Mortgage interest: same shape, isolated, so accountants can apply S.24.
   *
   * If ownerId is supplied, totals are also returned at the allocated share
   * (looked up in expense_allocation_rules, falling back to equal split).
   */
  async getTaxYearReport(params: {
    propertyId: number;
    startDate: string;
    endDate: string;
    ownerId?: number | null;
  }): Promise<RentalReportResult> {
    const db = getDb();
    const { propertyId, startDate, endDate, ownerId = null } = params;

    const rows = await db.execute(sql`
      SELECT je.id           AS journal_id,
             je.date         AS date,
             je.description  AS description,
             je.reference    AS reference,
             c.name          AS category,
             a.name          AS account,
             a.account_type  AS account_type,
             be.amount::numeric AS amount
      FROM journal_entries je
      JOIN book_entries be ON be.journal_entry_id = je.id
      JOIN accounts a      ON a.id = be.account_id
      LEFT JOIN categories c ON c.id = je.category_id
      WHERE je.property_id = ${propertyId}
        AND je.date >= ${startDate}
        AND je.date <= ${endDate}
        AND a.account_type IN ('INCOME', 'EXPENSE')
      ORDER BY je.date ASC, je.id ASC
    `);

    const income: RentalReportLine[] = [];
    const expenses: RentalReportLine[] = [];
    const mortgageInterest: RentalReportLine[] = [];

    for (const r of rows.rows as Array<Record<string, unknown>>) {
      const amount = new Decimal((r.amount as string | number).toString());
      const accountType = r.account_type as string;
      const account = r.account as string;

      const line: RentalReportLine = {
        journalId: r.journal_id as number,
        date: r.date as string,
        description: r.description as string,
        reference: (r.reference as string | null) ?? null,
        category: (r.category as string | null) ?? null,
        account,
        // Income posts as a credit (negative); expenses as a debit (positive).
        // Report as positive magnitudes — sign is implied by the bucket.
        amount: amount.abs().toFixed(2),
      };

      if (accountType === 'INCOME') {
        income.push(line);
      } else if (account === MORTGAGE_INTEREST_ACCOUNT) {
        mortgageInterest.push(line);
      } else {
        expenses.push(line);
      }
    }

    const sumLines = (lines: RentalReportLine[]) =>
      lines.reduce((acc, l) => acc.plus(l.amount), new Decimal(0));

    const grossIncome = sumLines(income);
    const totalExpenses = sumLines(expenses);
    const mortgageInterestTotal = sumLines(mortgageInterest);

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
      income,
      expenses,
      mortgageInterest,
      totals,
      totalsForOwner,
    };
  },
};

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
