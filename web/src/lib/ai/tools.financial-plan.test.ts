import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildFinancialPlan } from '@/lib/planning/engine';
import type { PlanningInput } from '@/lib/planning/types';
import { projectRetirement, type RetirementInput } from '@/lib/retirement/projection';

const { loadPlanningInput, getGoals, listEntries, categorizeBatch } = vi.hoisted(() => ({
  loadPlanningInput: vi.fn(),
  getGoals: vi.fn(),
  listEntries: vi.fn(),
  categorizeBatch: vi.fn(),
}));

vi.mock('@/lib/planning/load', () => ({ loadPlanningInput }));
vi.mock('@/lib/repos', () => ({
  accountRepo: {}, journalRepo: { listEntries }, categoryRepo: {}, propertyRepo: {}, tipRepo: {}, budgetRepo: {},
  savingsGoalRepo: { getAll: getGoals }, aiMemoryRepo: {}, ownerTaxRepo: {},
}));
vi.mock('./claude-client', () => ({ categorizeBatch }));

import { executeTool, TOOL_DEFINITIONS, TOOL_LABELS } from './tools';
import { prepareContext } from './data-preparer';

function input(): PlanningInput {
  return {
    asOf: '2026-10-11',
    transactions: ['07', '08', '09'].flatMap((month, index) => [
      { id: index * 3, date: `2026-${month}-01`, description: 'Salary', category: 'Salary', amount: 3000, cashflowType: 'income' as const },
      { id: index * 3 + 1, date: `2026-${month}-02`, description: 'Shopping', category: 'Shopping', amount: -1000, cashflowType: 'expense' as const },
      { id: index * 3 + 2, date: `2026-${month}-03`, description: 'Refund', category: 'Shopping', amount: 100, cashflowType: 'refund' as const },
    ]),
    accounts: [
      { id: 1, name: 'Cash', accountType: 'ASSET', balance: 500, isLiquidCash: true },
      { id: 2, name: 'Pension', accountType: 'ASSET', balance: 50000, isInvestment: true, investmentKind: 'pension' },
      { id: 3, name: 'Credit card', accountType: 'LIABILITY', balance: -2000 },
    ],
    properties: [{ id: 1, name: 'Rental', value: 200000, debt: 100000, monthlyRent: 1200, monthlyCosts: null }],
    budgets: [{ category: 'Shopping', monthlyLimit: 800 }],
    profile: { essentialMonthlySpending: 1000, emergencyFundMonths: 3 },
  };
}

function loaded(planningInput = input()) {
  return {
    input: planningInput,
    source: {
      scope: 'household' as const, asOf: planningInput.asOf,
      periodStart: '2026-04-01', periodEnd: '2026-09-30', transactionCount: planningInput.transactions.length,
      coverageMonths: ['2026-07', '2026-08', '2026-09'], latestTransactionDate: '2026-09-03', warnings: [],
    },
    profileSaved: true,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadPlanningInput.mockResolvedValue(loaded());
  getGoals.mockResolvedValue([]);
  listEntries.mockResolvedValue([]);
});

describe('adviser financial plan', () => {
  it('registers a read-only tool without balance-changing inputs or provider calls', async () => {
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === 'get_financial_plan');
    expect(definition?.input_schema).toEqual({ type: 'object', properties: {}, required: [] });
    expect(definition?.description).toContain('Read-only');
    expect(TOOL_LABELS.get_financial_plan).toBeTruthy();
    const result = await executeTool('get_financial_plan', {});
    expect(result).toMatchObject(buildFinancialPlan(input()));
    expect(result).toMatchObject({ dataSource: loaded().source, profileSaved: true, retirementScenario: { status: 'inputs-required' } });
    expect(categorizeBatch).not.toHaveBeenCalled();
  });

  it('preserves missing essentials and missing financial history as unknown', async () => {
    const incomplete = { ...input(), transactions: [], profile: null };
    loadPlanningInput.mockResolvedValue(loaded(incomplete));
    const result = await executeTool('get_financial_health_check', {});
    expect(result).toMatchObject({
      savingsRate: null, savingsRateStatus: 'unknown', monthlySurplus: null, debtToIncome: null,
      emergencyFund: { target: null, monthlyExpenses: null, monthsToSave: null, status: 'unknown' },
    });
  });

  it('health summary uses refunds, accessible cash and reserve shortfall from the shared plan', async () => {
    const result = await executeTool('get_financial_health_check', {});
    expect(result).toMatchObject({
      monthlySurplus: '£2,100.00', savingsRate: '70.0%', debtToIncome: '283%',
      emergencyFund: { cashAvailable: '£500.00', target: '£3,000.00', shortfall: '£2,500.00', monthsToSave: 2 },
      budgetAdherence: { overBudget: 1 },
    });
    expect(result).toHaveProperty('methodology');
    expect(result).toHaveProperty('coverage');
  });

  it('does not expose connection secrets or fabricate empty successful results after load failure', async () => {
    loadPlanningInput.mockRejectedValue(new Error('postgres://alice:private-secret@db.example/finances'));
    for (const tool of ['get_financial_plan', 'get_financial_health_check', 'get_income_expense_summary']) {
      const result = await executeTool(tool, {});
      expect(result).toMatchObject({ status: 'unavailable' });
      expect(JSON.stringify(result)).not.toContain('private-secret');
      expect(result).not.toHaveProperty('cashflow');
    }
    const context = await prepareContext('Review my finances');
    expect(context).toContain('UNAVAILABLE');
    expect(context).not.toContain('private-secret');
  });

  it('runs retirement illustrations only with complete saved assumptions', async () => {
    const retirementScenario: RetirementInput = {
      currentAge: 40, retirementAge: 60, currentPot: 50000, monthlyContribution: 400,
      monthlyEmployerContribution: 100, annualGrowthRate: 4, annualFeeRate: 0.5, inflationRate: 2,
      desiredAnnualIncome: 30000, expectedAnnualStatePension: 0, statePensionAge: 68,
      withdrawalRate: 3.5, sensitivitySpread: 2,
    };
    const planningInput = input();
    planningInput.profile = { ...planningInput.profile, retirementScenario };
    loadPlanningInput.mockResolvedValue(loaded(planningInput));
    const result = await executeTool('get_financial_plan', {});
    expect(result).toMatchObject({ retirementScenario: {
      status: 'illustration', assumptions: retirementScenario, projection: projectRetirement(retirementScenario),
    } });
  });

  it('income summaries exclude incomplete current months and refuse unknown averages', async () => {
    const result = await executeTool('get_income_expense_summary', { months: 3 });
    expect(result).toMatchObject({ averageMonthlyIncome: '£3,000.00', averageMonthlyExpenses: '£900.00', observedMonths: 3 });
    expect(JSON.stringify(result)).not.toContain('2026-10');
    const beyondCoverage = await executeTool('get_income_expense_summary', { months: 12 });
    expect(beyondCoverage).toMatchObject({ averageMonthlyIncome: null, averageMonthlyExpenses: null, requestedMonths: 12, observedMonths: 3, loadedMonths: 6 });
    expect((beyondCoverage as { months: unknown[] }).months).toHaveLength(12);
    expect(beyondCoverage).toHaveProperty('missingRequestedMonths');
    expect(await executeTool('get_income_expense_summary', { months: 1.5 })).toHaveProperty('error');
  });

  it('context preserves plan evidence and currency without converting a display symbol', async () => {
    const context = await prepareContext('Review my pensions and property', '$');
    expect(context).toContain('"currency": "GBP"');
    expect(context).toContain('"cash": 500');
    expect(context).toContain('"retirementScenario"');
    expect(context).toContain('"methodology"');
    expect(listEntries).not.toHaveBeenCalled();
  });
});
