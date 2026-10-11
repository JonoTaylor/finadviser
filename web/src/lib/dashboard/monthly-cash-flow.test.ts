import { describe, expect, it } from 'vitest';
import { monthlyCashFlow, monthlyCategories, previousMonth, type MonthlySpendingRow } from './monthly-cash-flow';

const row = (account_type: string, total: string, category_name: string | null = null, month = '2026-10'): MonthlySpendingRow =>
  ({ account_type, total, category_name, month });

describe('signed monthly cash flow', () => {
  it('uses income credits and subtracts refunds and income reversals before calculating the rate', () => {
    const flow = monthlyCashFlow([
      row('INCOME', '-4000', 'Salary'),
      row('INCOME', '100', 'Salary'),
      row('EXPENSE', '2000', 'Household'),
      row('EXPENSE', '-300', 'Refunds'),
    ], '2026-10');
    expect(flow.income.toFixed(2)).toBe('3900.00');
    expect(flow.expenses.toFixed(2)).toBe('1700.00');
    expect(flow.surplus.toFixed(2)).toBe('2200.00');
    expect(flow.savingsRate).toBeCloseTo(2200 / 3900 * 100, 10);
  });

  it('does not include other months, the same month in another year, or asset and liability transfer legs', () => {
    const flow = monthlyCashFlow([
      row('INCOME', '-3000'), row('EXPENSE', '1500'),
      row('INCOME', '-120000', null, '2025-10'),
      row('EXPENSE', '99000', null, '2026-09'),
      row('ASSET', '-10000'), row('ASSET', '10000'), row('LIABILITY', '5000'),
    ], '2026-10');
    expect(flow.income.toString()).toBe('3000');
    expect(flow.expenses.toString()).toBe('1500');
    expect(flow.savingsRate).toBe(50);
  });

  it('reports a negative rate for overspending and keeps net refund months signed', () => {
    expect(monthlyCashFlow([row('INCOME', '-1000'), row('EXPENSE', '1250')], '2026-10').savingsRate).toBe(-25);
    const refundMonth = monthlyCashFlow([row('INCOME', '-1000'), row('EXPENSE', '-100')], '2026-10');
    expect(refundMonth.expenses.toString()).toBe('-100');
    expect(refundMonth.savingsRate).toBe(110);
  });

  it('does not invent a savings rate when income is absent, zero, or reversed', () => {
    for (const rows of [[], [row('INCOME', '0')], [row('INCOME', '100')], [row('EXPENSE', '200')]]) {
      expect(monthlyCashFlow(rows, '2026-10').savingsRate).toBeNull();
    }
    expect(monthlyCashFlow([row('INCOME', '100')], '2026-10').income.toString()).toBe('-100');
  });

  it('adds monetary values exactly at penny precision', () => {
    const flow = monthlyCashFlow([row('INCOME', '-0.30'), row('EXPENSE', '0.10'), row('EXPENSE', '0.20')], '2026-10');
    expect(flow.surplus.toString()).toBe('0');
    expect(flow.savingsRate).toBe(0);
  });
});

describe('monthly category comparisons', () => {
  it('keeps income and expenses with the same name distinct, nets refunds, and compares the correct year boundary', () => {
    const categories = monthlyCategories([
      row('INCOME', '-3000', 'Other', '2026-01'),
      row('EXPENSE', '500', 'Other', '2026-01'),
      row('EXPENSE', '-100', 'Other', '2026-01'),
      row('INCOME', '-2500', 'Other', '2025-12'),
      row('EXPENSE', '450', 'Other', '2025-12'),
      row('EXPENSE', '99000', 'Other', '2025-01'),
      row('ASSET', '10000', 'Other', '2026-01'),
    ], '2026-01');
    expect(categories.map(c => [c.accountType, c.category, c.amount.toString(), c.previous.toString()])).toEqual([
      ['INCOME', 'Other', '3000', '2500'],
      ['EXPENSE', 'Other', '400', '450'],
    ]);
    expect(categories[0].key).not.toBe(categories[1].key);
  });

  it('retains a negative refund bucket and omits fully reversed categories', () => {
    const categories = monthlyCategories([
      row('EXPENSE', '-50', null), row('EXPENSE', '50', 'Cancelled'), row('EXPENSE', '-50', 'Cancelled'),
    ], '2026-10');
    expect(categories).toHaveLength(1);
    expect(categories[0].category).toBe('Uncategorized');
    expect(categories[0].amount.toString()).toBe('-50');
  });

  it('calculates the previous month across years', () => {
    expect(previousMonth('2026-01')).toBe('2025-12');
    expect(previousMonth('2026-10')).toBe('2026-09');
  });
});
