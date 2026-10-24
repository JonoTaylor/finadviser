import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  spending: vi.fn(), properties: vi.fn(), valuation: vi.fn(), mortgages: vi.fn(),
  balance: vi.fn(), equity: vi.fn(),
}));
vi.mock('@/lib/repos', () => ({
  journalRepo: { getMonthlySpending: mocks.spending },
  propertyRepo: { listProperties: mocks.properties, getLatestValuation: mocks.valuation,
    getMortgages: mocks.mortgages, getMortgageBalance: mocks.balance },
  accountRepo: {}, categoryRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {}, aiMemoryRepo: {}, ownerTaxRepo: {},
}));
vi.mock('@/lib/properties/equity-calculator', () => ({ calculateEquity: mocks.equity }));
import { executeTool } from './tools';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.properties.mockResolvedValue([{ id: 8, name: 'Fixture rental', address: null, purchasePrice: '200000' }]);
  mocks.mortgages.mockResolvedValue([{ id: 3, lender: 'Fixture lender' }]);
  mocks.balance.mockResolvedValue('-150000');
});

describe('financial evidence supplied to specialists', () => {
  it('excludes employment income and preserves a net merchant refund as negative spending', async () => {
    mocks.spending.mockResolvedValue([
      { month: '2026-09', category_name: 'Salary', account_type: 'INCOME', total: '-3000.00' },
      { month: '2026-09', category_name: 'Food', account_type: 'EXPENSE', total: '200.00' },
      { month: '2026-09', category_name: 'Shopping', account_type: 'EXPENSE', total: '-50.00' },
      { month: '2026-08', category_name: 'Salary', account_type: 'INCOME', total: '-3000.00' },
    ]);
    expect(await executeTool('get_monthly_spending', {})).toEqual({
      '2026-09': [{ category: 'Food', total: '£200.00' }, { category: 'Shopping', total: '-£50.00' }],
    });
  });

  it('does not turn an invalid aggregate into a confirmed zero spend', async () => {
    mocks.spending.mockResolvedValue([{ month: '2026-09', category_name: 'Food', account_type: 'EXPENSE', total: 'NaN' }]);
    await expect(executeTool('get_monthly_spending', {})).rejects.toThrow('amount is invalid');
  });

  it('keeps owner equity unknown when the valuation is absent instead of treating the property as worth zero', async () => {
    mocks.valuation.mockResolvedValue(null);
    const result = await executeTool('get_property_summary', {}) as { currentValuation: string | null; ownerEquity: unknown; ownerEquityBasis: string }[];
    expect(result[0]).toMatchObject({ currentValuation: null, ownerEquity: null });
    expect(result[0].ownerEquityBasis).toContain('Unknown');
    expect(mocks.equity).not.toHaveBeenCalled();
    expect(result[0]).toHaveProperty('mortgages', [{ lender: 'Fixture lender', balance: '£150,000.00' }]);
  });

  it('retains a real negative-equity estimate when an actual recorded valuation supports it', async () => {
    mocks.valuation.mockResolvedValue({ valuation: '100000.00' });
    mocks.equity.mockResolvedValue([{ name: 'Fixture owner', equityAmount: new Decimal('-25000'), equityPct: 50 }]);
    const result = await executeTool('get_property_summary', {}) as { ownerEquity: unknown; ownerEquityBasis: string }[];
    expect(result[0].ownerEquity).toEqual([{ owner: 'Fixture owner', amount: '-£25,000.00', percentage: '50.0%' }]);
    expect(result[0].ownerEquityBasis).toContain('recorded valuation');
    expect(mocks.equity).toHaveBeenCalledExactlyOnceWith(8);
  });
});
