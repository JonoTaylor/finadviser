import Decimal from 'decimal.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { londonTodayIso } from '@/lib/dates/today';
import { appSettingsRepo } from '@/lib/repos/app-settings.repo';
import { retirementInputSchema } from '@/lib/retirement/projection';
import type { PlanningInput, PlanningProfile, PlanningTransaction } from './types';

export const PLANNING_PROFILE_KEY = 'planning.profile.v1';

const optionalMoney = z.number().finite().min(0).max(999_999_999_999.99).nullable().default(null);
export const planningProfileSchema = z.object({
  essentialMonthlySpending: optionalMoney,
  emergencyFundMonths: z.number().finite().int().min(1).max(24).nullable().default(3),
  monthlySavingsTarget: optionalMoney,
  investmentHorizonYears: z.number().finite().min(0).max(80).nullable().default(null),
  riskTolerance: z.enum(['low', 'medium', 'high']).nullable().default(null),
  currentAge: z.number().int().min(18).max(100).nullable().default(null),
  retirementAge: z.number().int().min(18).max(100).nullable().default(null),
  monthlyPensionContribution: optionalMoney,
  targetRetirementIncome: optionalMoney,
  statePensionAnnual: optionalMoney,
  retirementScenario: retirementInputSchema.strict().nullable().default(null),
}).strict().superRefine((profile, ctx) => {
  if (profile.currentAge !== null && profile.retirementAge !== null && profile.retirementAge < profile.currentAge) {
    ctx.addIssue({ code: 'custom', path: ['retirementAge'], message: 'must be at least currentAge' });
  }
});

export class InvalidPlanningProfileError extends Error {
  constructor() {
    super('The saved planning profile is invalid. Save your planning assumptions again to repair it.');
    this.name = 'InvalidPlanningProfileError';
  }
}

export class InvalidPlanningDataError extends Error {
  constructor(message = 'Some recorded financial data is invalid. Review ledger amounts, dates and property account mappings before generating a plan.') {
    super(message);
    this.name = 'InvalidPlanningDataError';
  }
}

export async function loadPlanningProfile(): Promise<{ profile: PlanningProfile; saved: boolean }> {
  const stored = await appSettingsRepo.get(PLANNING_PROFILE_KEY);
  if (stored === null) return { profile: planningProfileSchema.parse({}), saved: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored);
  } catch {
    throw new InvalidPlanningProfileError();
  }
  const result = planningProfileSchema.safeParse(parsed);
  if (!result.success) throw new InvalidPlanningProfileError();
  return { profile: result.data, saved: true };
}

export async function savePlanningProfile(profile: PlanningProfile): Promise<void> {
  await appSettingsRepo.set(PLANNING_PROFILE_KEY, JSON.stringify(planningProfileSchema.parse(profile)));
}

export interface PlanningDataSource {
  scope: 'household';
  cashAccessibility: 'inferred';
  asOf: string;
  periodStart: string;
  periodEnd: string;
  transactionCount: number;
  coverageMonths: string[];
  latestTransactionDate: string | null;
  warnings: string[];
}

type AccountRow = {
  id: number;
  name: string;
  account_type: PlanningInput['accounts'][number]['accountType'];
  balance: string;
  is_investment: boolean;
  investment_kind: string | null;
  owner_id: number | null;
  is_property_asset: boolean;
  is_mortgage: boolean;
};

type TransactionRow = {
  id: string;
  date: string;
  description: string;
  merchant_name: string | null;
  category: string;
  category_id: number | null;
  category_ancestor_ids: number[] | null;
  property_id: number | null;
  account_type: 'INCOME' | 'EXPENSE' | 'PRINCIPAL';
  amount: string;
};

type PropertyRow = {
  id: number;
  name: string;
  value: string | null;
  valuation_date: string | null;
  debt: string;
  mortgage_count: number;
  shared_mortgage_account: boolean;
};

function amount(value: string | number): number {
  try {
    const decimal = new Decimal(value);
    if (!decimal.isFinite()) throw new InvalidPlanningDataError();
    return decimal.toDecimalPlaces(2).toNumber();
  } catch {
    throw new InvalidPlanningDataError();
  }
}

function isLiquidCash(account: AccountRow): boolean {
  if (account.account_type !== 'ASSET' || account.is_property_asset) return false;
  // Investment tagging is authoritative: pensions and market investments
  // must never inflate the accessible emergency fund.
  if (/\b(fixed|term|notice|locked|bond)\b/i.test(account.name)) return false;
  if (account.is_investment) return account.investment_kind === 'savings';
  return /\b(bank|cash|current|savings|monzo|barclays|natwest|hsbc|lloyds|starling|revolut|santander)\b/i.test(account.name);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Read the real ledger. Failures propagate to the API; an unavailable
 * database must never be presented as an empty household or a zero balance.
 * Balance-sheet scope is the whole recorded household, including all owners.
 */
export async function loadPlanningInput(now = new Date()): Promise<{
  input: PlanningInput;
  source: PlanningDataSource;
  profileSaved: boolean;
}> {
  const asOf = londonTodayIso(now);
  const calendarDate = new Date(`${asOf}T00:00:00Z`);
  const periodStart = isoDay(new Date(Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() - 6, 1)));
  const recentMonths = [3, 2, 1].map(offset =>
    isoDay(new Date(Date.UTC(calendarDate.getUTCFullYear(), calendarDate.getUTCMonth() - offset, 1))).slice(0, 7),
  );
  const db = getDb();
  const [accountResult, transactionResult, propertyResult, budgetResult, profileResult] = await Promise.all([
    db.execute(sql`
      SELECT a.id, a.name, a.account_type,
             (v.balance - COALESCE((
               SELECT SUM(future_book.amount::numeric)
               FROM book_entries future_book
               JOIN journal_entries future_journal ON future_journal.id = future_book.journal_entry_id
               WHERE future_book.account_id = a.id AND future_journal.date > ${asOf}
             ), 0))::text AS balance,
             a.is_investment, a.investment_kind, a.owner_id,
             EXISTS (SELECT 1 FROM mortgages m WHERE m.liability_account_id = a.id) AS is_mortgage,
             EXISTS (
               SELECT 1 FROM properties p
               WHERE a.account_type = 'ASSET' AND (
                 lower(a.name) = lower(p.name)
                 OR lower(a.name) = lower('Property: ' || p.name)
                 OR lower(a.name) = lower('Property - ' || p.name)
               )
             ) AS is_property_asset
      FROM accounts a
      JOIN v_account_balances v ON v.account_id = a.id
      WHERE a.account_type IN ('ASSET', 'LIABILITY')
      ORDER BY a.name
    `),
    db.execute(sql`
      WITH RECURSIVE category_ancestry AS (
        SELECT id AS category_id, id AS ancestor_id, parent_id, ARRAY[id] AS visited
        FROM categories
        UNION ALL
        SELECT walk.category_id, parent.id, parent.parent_id, walk.visited || parent.id
        FROM category_ancestry walk JOIN categories parent ON parent.id = walk.parent_id
        WHERE NOT parent.id = ANY(walk.visited)
      ), category_paths AS (
        SELECT category_id, ARRAY_AGG(ancestor_id) AS ancestor_ids
        FROM category_ancestry GROUP BY category_id
      ), eligible_journals AS (
        SELECT je.* FROM journal_entries je
        WHERE je.date >= ${periodStart} AND je.date <= ${asOf}
          AND COALESCE(je.is_transfer, FALSE) = FALSE
      ), cashflow_legs AS (
        SELECT be.journal_entry_id, a.account_type::text AS account_type,
               SUM(be.amount::numeric) AS amount
        FROM book_entries be
        JOIN eligible_journals eligible ON eligible.id = be.journal_entry_id
        JOIN accounts a ON a.id = be.account_id
        WHERE a.account_type IN ('INCOME', 'EXPENSE')
        GROUP BY be.journal_entry_id, a.account_type
        UNION ALL
        SELECT be.journal_entry_id, 'PRINCIPAL', SUM(be.amount::numeric)
        FROM book_entries be
        JOIN eligible_journals payment ON payment.id = be.journal_entry_id
        WHERE EXISTS (SELECT 1 FROM mortgages m WHERE m.liability_account_id = be.account_id)
          AND (payment.reference LIKE 'mortgage_payment:%' OR payment.description LIKE 'Mortgage payment - %')
        GROUP BY be.journal_entry_id
      )
      SELECT je.id::text || ':' || legs.account_type AS id, je.date, je.description,
             tm.merchant_name, je.property_id, legs.account_type,
             CASE WHEN legs.account_type = 'PRINCIPAL' THEN NULL ELSE je.category_id END AS category_id,
             CASE WHEN legs.account_type = 'PRINCIPAL' THEN NULL ELSE paths.ancestor_ids END AS category_ancestor_ids,
             CASE WHEN legs.account_type = 'PRINCIPAL' THEN 'Mortgage principal'
                  ELSE COALESCE(c.name, 'Uncategorised') END AS category,
             (-legs.amount)::text AS amount
      FROM cashflow_legs legs
      JOIN eligible_journals je ON je.id = legs.journal_entry_id
      LEFT JOIN categories c ON c.id = je.category_id
      LEFT JOIN category_paths paths ON paths.category_id = je.category_id
      LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
      WHERE legs.amount <> 0
      ORDER BY je.date, je.id, legs.account_type
    `),
    db.execute(sql`
      SELECT p.id, p.name, pv.valuation::text AS value, pv.valuation_date,
             COALESCE(debt.amount, 0)::text AS debt,
             COALESCE(debt.mortgage_count, 0)::integer AS mortgage_count,
             EXISTS (
               SELECT 1 FROM mortgages own_mortgage
               JOIN mortgages other_mortgage ON other_mortgage.liability_account_id = own_mortgage.liability_account_id
               WHERE own_mortgage.property_id = p.id AND other_mortgage.property_id <> p.id
             ) AS shared_mortgage_account
      FROM properties p
      LEFT JOIN LATERAL (
        SELECT valuation, valuation_date FROM property_valuations
        WHERE property_id = p.id AND valuation_date <= ${asOf}
        ORDER BY valuation_date DESC, id DESC LIMIT 1
      ) pv ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(GREATEST(-(v.balance - COALESCE((
                 SELECT SUM(future_book.amount::numeric)
                 FROM book_entries future_book
                 JOIN journal_entries future_journal ON future_journal.id = future_book.journal_entry_id
                 WHERE future_book.account_id = m.liability_account_id AND future_journal.date > ${asOf}
               ), 0)), 0)) AS amount, COUNT(*) AS mortgage_count
        FROM (SELECT DISTINCT liability_account_id FROM mortgages WHERE property_id = p.id) m
        JOIN v_account_balances v ON v.account_id = m.liability_account_id
      ) debt ON TRUE
      ORDER BY p.name
    `),
    db.execute(sql`
      SELECT c.id AS category_id, c.name AS category, b.monthly_limit
      FROM budgets b JOIN categories c ON c.id = b.category_id
      WHERE b.effective_from <= ${asOf}
      ORDER BY c.name
    `),
    loadPlanningProfile(),
  ]);

  const accountRows = accountResult.rows as unknown as AccountRow[];
  const transactionRows = transactionResult.rows as unknown as TransactionRow[];
  const propertyRows = propertyResult.rows as unknown as PropertyRow[];
  if (propertyRows.some(property => property.shared_mortgage_account)) {
    throw new InvalidPlanningDataError('A mortgage liability account is linked to more than one property. Correct the property account mappings so debt is counted once.');
  }
  const transactions: PlanningTransaction[] = transactionRows.map(row => {
    const signedAmount = amount(row.amount);
    return {
      id: row.id,
      date: row.date,
      description: row.description,
      merchant: row.merchant_name,
      category: row.category,
      categoryId: row.category_id ?? null,
      categoryAncestorIds: row.category_ancestor_ids ?? [],
      amount: signedAmount,
      propertyId: row.property_id,
      cashflowType: row.account_type === 'INCOME' ? 'income' : signedAmount > 0 ? 'refund' : 'expense',
    };
  });
  const coverageMonths = [...new Set(transactions.map(transaction => transaction.date.slice(0, 7)))].sort();
  const recentCovered = recentMonths.every(month => coverageMonths.includes(month));
  const warnings = [
    'Balances cover the whole recorded household, including shared property and every owner. They are not one person’s ownership share.',
    'Imported activity can be incomplete even when every month has transactions. Reconcile accounts before relying on a spending or surplus figure.',
    'Cash outgoings include recorded mortgage principal repayments. Investment and account transfers are excluded, so surplus is before saving or investing.',
    'All figures are treated as GBP; convert foreign-currency accounts into GBP before including their balances.',
    'Cash accessibility is inferred from bank/cash account names and savings tags. Confirm withdrawal restrictions, earmarked money and account completeness before relying on emergency-fund coverage.',
    'Property monthly rent and costs are averages of tagged ledger activity over the last three completed months. They do not include unrecorded rent schedules, tax, future repairs or missing mortgage payments.',
  ];
  if (transactions.length === 0) warnings.push('No income or expense activity was found in the last six completed months or the current month. Import transactions to establish cashflow.');
  if (accountRows.some(account => account.account_type === 'ASSET' && !account.is_investment && !account.is_property_asset && !isLiquidCash(account))) {
    warnings.push('Some assets cannot be confirmed as accessible cash from their account names. They are excluded from the emergency fund; review account names and investment tags.');
  }
  if (accountRows.some(account => account.is_property_asset)) {
    warnings.push('Property-named asset accounts are represented by their recorded property valuations rather than counted a second time. Review ambiguous account names.');
  }
  const staleDate = isoDay(new Date(Date.UTC(calendarDate.getUTCFullYear() - 1, calendarDate.getUTCMonth(), calendarDate.getUTCDate())));
  for (const property of propertyRows) {
    if (property.value === null) warnings.push(`${property.name} has no recorded valuation. Its market value and equity are unknown.`);
    else if (property.valuation_date !== null && property.valuation_date < staleDate) warnings.push(`${property.name} has a valuation older than a year (${property.valuation_date}). Update it before making decisions.`);
    if (property.mortgage_count > 0 && !transactions.some(transaction => transaction.propertyId === property.id && transaction.category === 'Mortgage principal')) {
      warnings.push(`${property.name}: no principal repayment records were found. Check mortgage payments; interest-only mortgages may have no principal repayments.`);
    }
  }

  return {
    input: {
      asOf,
      cashAccessibility: 'inferred',
      transactions,
      // Mortgage debt is netted against properties once. The acquisition
      // value of identifiable property assets is replaced by its valuation.
      accounts: accountRows.filter(account => !account.is_property_asset && (!account.is_mortgage || amount(account.balance) > 0)).map(account => ({
        id: account.id,
        name: account.name,
        accountType: account.account_type,
        balance: amount(account.balance),
        isInvestment: account.is_investment,
        investmentKind: account.investment_kind,
        ownerId: account.owner_id,
        isLiquidCash: isLiquidCash(account),
      })),
      properties: propertyRows.map(property => {
        const activity = transactions.filter(transaction => transaction.propertyId === property.id && recentMonths.includes(transaction.date.slice(0, 7)));
        const income = activity.filter(transaction => transaction.cashflowType === 'income');
        const expenses = activity.filter(transaction => transaction.cashflowType !== 'income');
        const rent = income.reduce((sum, transaction) => sum.plus(transaction.amount), new Decimal(0)).div(3);
        const costs = expenses.reduce((sum, transaction) => sum.minus(transaction.amount), new Decimal(0)).div(3);
        return {
          id: property.id,
          name: property.name,
          value: property.value === null ? null : amount(property.value),
          debt: amount(property.debt),
          // Absence of tagged rental receipts/costs is unknown, not proof
          // of zero rent, a vacant property or cost-free ownership.
          monthlyRent: recentCovered && income.length > 0 && rent.gte(0) ? amount(rent.toString()) : null,
          monthlyCosts: recentCovered && expenses.length > 0 && costs.gte(0) ? amount(costs.toString()) : null,
        };
      }),
      budgets: (budgetResult.rows as unknown as Array<{ category_id: number; category: string; monthly_limit: string }>).map(row => ({ categoryId: row.category_id, category: row.category, monthlyLimit: amount(row.monthly_limit) })),
      profile: profileResult.profile,
    },
    profileSaved: profileResult.saved,
    source: {
      scope: 'household',
      cashAccessibility: 'inferred',
      asOf,
      periodStart,
      periodEnd: asOf,
      transactionCount: new Set(transactions.map(transaction => String(transaction.id).split(':')[0])).size,
      coverageMonths,
      latestTransactionDate: transactions.length > 0 ? transactions[transactions.length - 1].date : null,
      warnings,
    },
  };
}
