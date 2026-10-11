import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const execute = vi.fn();
const get = vi.fn();
const set = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/repos/app-settings.repo', () => ({ appSettingsRepo: { get: (...args: unknown[]) => get(...args), set: (...args: unknown[]) => set(...args) } }));

import { InvalidPlanningDataError, InvalidPlanningProfileError, loadPlanningInput, loadPlanningProfile, PLANNING_PROFILE_KEY, planningProfileSchema, savePlanningProfile } from './load';

const account = (patch: Record<string, unknown>) => ({
  id: 1, name: 'Bank', account_type: 'ASSET', balance: '500.00',
  is_investment: false, investment_kind: null, owner_id: null,
  is_property_asset: false, is_mortgage: false, ...patch,
});
const transaction = (patch: Record<string, unknown>) => ({
  id: '1:EXPENSE', date: '2026-09-01', description: 'Shop', merchant_name: 'Grocer',
  category: 'Food', property_id: null, account_type: 'EXPENSE', amount: '-100.00',
  category_id: 1, category_ancestor_ids: [1], ...patch,
});

function rows(accounts: unknown[] = [], transactions: unknown[] = [], properties: unknown[] = [], budgets: unknown[] = []) {
  execute.mockResolvedValueOnce({ rows: accounts });
  execute.mockResolvedValueOnce({ rows: transactions });
  execute.mockResolvedValueOnce({ rows: properties });
  execute.mockResolvedValueOnce({ rows: budgets });
}

beforeEach(() => {
  execute.mockReset();
  get.mockReset().mockResolvedValue(null);
  set.mockReset().mockResolvedValue(undefined);
});

describe('real-ledger planning adapter', () => {
  it('preserves income, expenses and refunds, nets property once, and excludes pensions from emergency cash', async () => {
    rows([
      account({ id: 1, name: 'Monzo current', balance: '2000' }),
      account({ id: 2, name: 'Work pension', is_investment: true, investment_kind: 'pension', balance: '70000' }),
      account({ id: 3, name: 'Property: Flat', is_property_asset: true, balance: '200000' }),
      account({ id: 4, name: 'Mortgage - Flat', account_type: 'LIABILITY', is_mortgage: true, balance: '-120000' }),
      account({ id: 5, name: 'Other asset', balance: '900' }),
      account({ id: 6, name: 'Easy access savings', is_investment: true, investment_kind: 'savings', balance: '1000' }),
      account({ id: 7, name: 'Amex', account_type: 'LIABILITY', balance: '-250' }),
    ], [
      transaction({ id: '1:INCOME', account_type: 'INCOME', amount: '3000' }),
      transaction({ id: '2:EXPENSE', amount: '-100' }),
      transaction({ id: '3:EXPENSE', amount: '20' }),
      transaction({ id: '4:PRINCIPAL', category: 'Mortgage principal', account_type: 'PRINCIPAL', property_id: 1, amount: '-300' }),
    ], [{ id: 1, name: 'Flat', value: '250000', valuation_date: '2026-09-15', debt: '120000', mortgage_count: 1 }]);
    const result = await loadPlanningInput(new Date('2026-10-11T12:00:00Z'));
    expect(result.input.transactions.map(tx => tx.cashflowType)).toEqual(['income', 'expense', 'refund', 'expense']);
    expect(result.input.accounts.map(ac => ac.id)).toEqual([1, 2, 5, 6, 7]);
    expect(result.input.accounts.filter(ac => ac.isLiquidCash).map(ac => ac.id)).toEqual([1, 6]);
    expect(result.input.accounts.find(ac => ac.id === 7)?.balance).toBe(-250);
    expect(result.input.properties[0]).toMatchObject({ value: 250000, debt: 120000, monthlyRent: null, monthlyCosts: null });
    expect(result.source).toMatchObject({ scope: 'household', periodStart: '2026-04-01', periodEnd: '2026-10-11', transactionCount: 4, coverageMonths: ['2026-09'] });
    expect(result.source.warnings.join(' ')).toContain('excluded from the emergency fund');
  });

  it('uses observed full recent periods for property outgoings and rent, including principal and refunds', async () => {
    rows([], [
      transaction({ id: '1:INCOME', date: '2026-07-01', account_type: 'INCOME', property_id: 1, amount: '900' }),
      transaction({ id: '2:INCOME', date: '2026-08-01', account_type: 'INCOME', property_id: 1, amount: '900' }),
      transaction({ id: '3:INCOME', date: '2026-09-01', account_type: 'INCOME', property_id: 1, amount: '900' }),
      transaction({ id: '4:EXPENSE', date: '2026-09-02', property_id: 1, amount: '-100' }),
      transaction({ id: '5:PRINCIPAL', date: '2026-09-03', category: 'Mortgage principal', account_type: 'PRINCIPAL', property_id: 1, amount: '-300' }),
      transaction({ id: '6:EXPENSE', date: '2026-09-04', property_id: 1, amount: '40' }),
    ], [{ id: 1, name: 'Flat', value: null, valuation_date: null, debt: '120000', mortgage_count: 1 }]);
    const result = await loadPlanningInput(new Date('2026-10-11T12:00:00Z'));
    expect(result.input.properties[0]).toMatchObject({ value: null, monthlyRent: 900, monthlyCosts: 120 });
    expect(result.source.warnings.join(' ')).toContain('no recorded valuation');
  });

  it('does not substitute empty activity for a failed data read', async () => {
    execute.mockRejectedValue(new Error('network failed'));
    await expect(loadPlanningInput()).rejects.toThrow('network failed');
  });

  it('uses the London calendar month at the BST midnight boundary', async () => {
    rows();
    const result = await loadPlanningInput(new Date('2026-09-30T23:30:00Z'));
    expect(result.source).toMatchObject({ asOf: '2026-10-01', periodStart: '2026-04-01' });
  });

  it('refuses to double-count one mortgage account linked to multiple properties', async () => {
    rows([], [], [{ id: 1, name: 'Flat', value: '200000', debt: '120000', valuation_date: '2026-09-01', mortgage_count: 1, shared_mortgage_account: true }]);
    await expect(loadPlanningInput()).rejects.toBeInstanceOf(InvalidPlanningDataError);
  });

  it('retains a positive mortgage-credit balance as an asset rather than discarding it', async () => {
    rows([account({ name: 'Mortgage - Flat', account_type: 'LIABILITY', is_mortgage: true, balance: '120' })], [], [{ id: 1, name: 'Flat', value: '200000', debt: '0', valuation_date: '2026-09-01', mortgage_count: 1 }]);
    const result = await loadPlanningInput();
    expect(result.input.accounts).toHaveLength(1);
    expect(result.input.accounts[0].balance).toBe(120);
    expect(result.input.properties[0].debt).toBe(0);
  });

  it('does not treat known restricted savings as accessible emergency cash', async () => {
    rows([account({ name: 'Fixed term savings', is_investment: true, investment_kind: 'savings' })]);
    const result = await loadPlanningInput();
    expect(result.input.accounts[0].isLiquidCash).toBe(false);
    expect(result.source.cashAccessibility).toBe('inferred');
  });

  it('uses saved cash confirmations and never makes a pension accessible', async () => {
    get.mockImplementation(async key => key === 'finance.context.v1' ? JSON.stringify({
      version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00.000Z', data: {
        ownerId: 2, accountAccessibility: [
          { accountId: 1, accessibility: 'available' }, { accountId: 2, accessibility: 'restricted' },
          { accountId: 3, accessibility: 'available' },
        ],
      },
    }) : null);
    rows([
      account({ id: 1, name: 'Cash reserve' }),
      account({ id: 2, name: 'Savings', is_investment: true, investment_kind: 'savings' }),
      account({ id: 3, name: 'Pension', is_investment: true, investment_kind: 'pension' }),
    ]);
    const result = await loadPlanningInput();
    expect(result.input.accounts.map(account => [account.id, account.isLiquidCash])).toEqual([[1, true], [2, false], [3, false]]);
    expect(result.source).toMatchObject({ cashAccessibility: 'confirmed', selectedOwnerId: 2, personalContextSaved: true });
  });

  it('requests only income/expense legs and explicit mortgage principal; transfers and equity adjustments cannot become income', async () => {
    rows();
    await loadPlanningInput(new Date('2026-10-11T00:00:00Z'));
    const query = new PgDialect().sqlToQuery(execute.mock.calls[1][0]);
    expect(query.sql).toContain("a.account_type IN ('INCOME', 'EXPENSE')");
    expect(query.sql).toContain('COALESCE(je.is_transfer, FALSE) = FALSE');
    expect(query.sql).toContain("payment.reference LIKE 'mortgage_payment:%'");
    expect(query.params).toEqual(['2026-04-01', '2026-10-11']);
  });

  it('counts a split journal once in source transaction count', async () => {
    rows([], [transaction({ id: '1:EXPENSE' }), transaction({ id: '1:INCOME', account_type: 'INCOME', amount: '150' })]);
    const result = await loadPlanningInput(new Date('2026-10-11T00:00:00Z'));
    expect(result.source.transactionCount).toBe(1);
  });

  it('passes category IDs and ancestors through to distinguish duplicate names and roll up parent budgets', async () => {
    rows([], [{ ...transaction({}), category_id: 5, category_ancestor_ids: [5, 2, 1] }], [], [
      { category_id: 1, category: 'Living', monthly_limit: '1000' },
      { category_id: 6, category: 'Living', monthly_limit: '500' },
    ]);
    const result = await loadPlanningInput();
    expect(result.input.transactions[0]).toMatchObject({ categoryId: 5, categoryAncestorIds: [5, 2, 1] });
    expect(result.input.budgets.map(budget => budget.categoryId)).toEqual([1, 6]);
  });

  it('subtracts future-dated ledger postings from account balances and mortgage debt as of the planning day', async () => {
    rows();
    await loadPlanningInput(new Date('2026-10-11T00:00:00Z'));
    const accountsQuery = new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    const propertiesQuery = new PgDialect().sqlToQuery(execute.mock.calls[2][0]);
    expect(accountsQuery.sql).toContain('future_journal.date >');
    expect(accountsQuery.params).toEqual(['2026-10-11']);
    expect(propertiesQuery.params).toEqual(['2026-10-11', '2026-10-11']);
  });
});

describe('saved planning assumptions', () => {
  it('starts with unknown personal facts, a disclosed three-month fund target, and no invented pension value', async () => {
    const result = await loadPlanningProfile();
    expect(result.saved).toBe(false);
    expect(result.profile).toMatchObject({ essentialMonthlySpending: null, emergencyFundMonths: 3, riskTolerance: null, statePensionAnnual: null, retirementScenario: null });
    expect(get).toHaveBeenCalledWith(PLANNING_PROFILE_KEY);
  });

  it('persists and reloads validated profile JSON in existing settings', async () => {
    const input = planningProfileSchema.parse({ essentialMonthlySpending: 1500, riskTolerance: 'medium', currentAge: 35, retirementAge: 65 });
    await savePlanningProfile(input);
    expect(set).toHaveBeenCalledWith(PLANNING_PROFILE_KEY, JSON.stringify(input));
    get.mockResolvedValue(JSON.stringify(input));
    expect(await loadPlanningProfile()).toEqual({ profile: input, saved: true });
  });

  it.each(['{', '{"riskTolerance":"speculative"}', '{"essentialMonthlySpending":-1}'])('surfaces corrupt stored profile without resetting it: %s', async value => {
    get.mockResolvedValue(value);
    await expect(loadPlanningProfile()).rejects.toBeInstanceOf(InvalidPlanningProfileError);
    expect(set).not.toHaveBeenCalled();
  });
});
