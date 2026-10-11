import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MonthlySummaryCard from './MonthlySummaryCard';
import SavingsRateCard from './SavingsRateCard';
import TopCategoriesCard from './TopCategoriesCard';

// Still September in UTC; the app's UK calendar is already October.
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-30T23:30:00Z')); });
afterEach(() => vi.useRealTimers());
const spending = [
  { month: '2026-10', account_type: 'INCOME', category_name: 'Salary', total: '-3000' },
  { month: '2026-10', account_type: 'EXPENSE', category_name: 'Shopping', total: '1600' },
  { month: '2026-10', account_type: 'EXPENSE', category_name: 'Shopping', total: '-100' },
  { month: '2026-09', account_type: 'INCOME', category_name: 'Salary', total: '-4000' },
];
const balances = [{ account_id: 1, account_name: 'Salary', account_type: 'INCOME', balance: '-140000' }];
const clean = (html: string) => html.replace(/<!-- -->/g, '');

describe('dashboard monthly cards', () => {
  it('shows the current London-month income and refunds rather than lifetime balances', () => {
    const html = clean(renderToString(createElement(MonthlySummaryCard, { spending, balances })));
    expect(html).toContain('£3,000.00');
    expect(html).toContain('£1,500.00');
    expect(html).not.toContain('£140,000.00');
    expect(html).not.toContain('£4,000.00');
  });

  it('shows a savings rate using only this month and no invented target', () => {
    const html = clean(renderToString(createElement(SavingsRateCard, { spending, balances })));
    expect(html).toContain('50%');
    expect(html).toContain('This month');
    expect(html).not.toContain('on track');
    expect(html).not.toContain('Target:');
  });

  it('shows an unavailable rate when only lifetime income exists', () => {
    const html = clean(renderToString(createElement(SavingsRateCard, { spending: [], balances })));
    expect(html).toContain('—');
    expect(html).toContain('Record positive income');
  });

  it('shows net spending and a distinct income label for category comparisons', () => {
    const html = clean(renderToString(createElement(TopCategoriesCard, { spending })));
    expect(html).toContain('Oct 2026');
    expect(html).toContain('Salary · income');
    expect(html).toContain('£1,500.00');
    expect(html).not.toContain('£1,700.00');
  });
});
