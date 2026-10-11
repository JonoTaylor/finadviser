import Decimal from 'decimal.js';

export interface MonthlySpendingRow {
  month: string;
  category_name: string | null;
  account_type: string;
  total: string;
}

export type CashFlowAccountType = 'INCOME' | 'EXPENSE';

export function previousMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  return monthNumber === 1
    ? `${year - 1}-12`
    : `${year}-${String(monthNumber - 1).padStart(2, '0')}`;
}

/**
 * The ledger stores debits as positive and credits as negative. Income
 * therefore changes sign for display; expense refunds keep their negative
 * sign and reduce spending. Taking absolute values would erase reversals.
 */
export function cashFlowAmount(row: MonthlySpendingRow): Decimal {
  const amount = new Decimal(row.total);
  return row.account_type === 'INCOME' ? amount.negated() : amount;
}

export function monthlyCashFlow(rows: MonthlySpendingRow[], month: string) {
  let income = new Decimal(0);
  let expenses = new Decimal(0);
  for (const row of rows) {
    if (row.month !== month) continue;
    if (row.account_type === 'INCOME') income = income.plus(cashFlowAmount(row));
    if (row.account_type === 'EXPENSE') expenses = expenses.plus(cashFlowAmount(row));
  }
  const surplus = income.minus(expenses);
  return {
    income,
    expenses,
    surplus,
    // Zero or reversed income cannot provide a meaningful denominator.
    savingsRate: income.gt(0) ? surplus.div(income).mul(100).toNumber() : null,
  };
}

export interface MonthlyCategory {
  key: string;
  category: string;
  accountType: CashFlowAccountType;
  amount: Decimal;
  previous: Decimal;
}

/** Keep income and expense buckets distinct even when their names match. */
export function monthlyCategories(rows: MonthlySpendingRow[], month: string): MonthlyCategory[] {
  const priorMonth = previousMonth(month);
  const categories = new Map<string, MonthlyCategory>();
  for (const row of rows) {
    if (row.month !== month && row.month !== priorMonth) continue;
    if (row.account_type !== 'INCOME' && row.account_type !== 'EXPENSE') continue;
    const category = row.category_name || 'Uncategorized';
    const key = `${row.account_type}:${category}`;
    const bucket = categories.get(key) ?? {
      key,
      category,
      accountType: row.account_type,
      amount: new Decimal(0),
      previous: new Decimal(0),
    };
    if (row.month === month) bucket.amount = bucket.amount.plus(cashFlowAmount(row));
    else bucket.previous = bucket.previous.plus(cashFlowAmount(row));
    categories.set(key, bucket);
  }
  return [...categories.values()]
    .filter(category => !category.amount.isZero())
    .sort((a, b) => b.amount.comparedTo(a.amount));
}
