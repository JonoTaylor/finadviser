import { describe, expect, it } from 'vitest';
import { buildFinancialPlan, PlanningValidationError } from './engine';
import type { PlanningAccount, PlanningInput, PlanningTransaction } from './types';
import type { RetirementInput } from '@/lib/retirement/projection';

function input(overrides: Partial<PlanningInput> = {}): PlanningInput {
  return { asOf: '2026-10-11', transactions: [], accounts: [], properties: [], budgets: [], ...overrides };
}

function transaction(id: number | string, date: string, amount: number, overrides: Partial<PlanningTransaction> = {}): PlanningTransaction {
  return { id, date, amount, description: 'Recorded payment', category: amount > 0 ? 'Income' : 'Food', cashflowType: amount > 0 ? 'income' : 'expense', ...overrides };
}

function account(id: number, balance: number, overrides: Partial<PlanningAccount> = {}): PlanningAccount {
  return { id, balance, name: `Account ${id}`, accountType: 'ASSET', ...overrides };
}

function sixMonths(previousSpending = 100, recentSpending = 200): PlanningTransaction[] {
  return ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].flatMap((month, index) => [
    transaction(index * 2 + 1, `${month}-05`, 1000, { category: 'Salary' }),
    transaction(index * 2 + 2, `${month}-15`, -(index < 3 ? previousSpending : recentSpending), { merchant: 'Grocer' }),
  ]);
}

describe('planning cashflow and honest coverage', () => {
  it('keeps absent cashflow, wealth and progress unknown rather than inventing zero values', () => {
    const plan = buildFinancialPlan(input({ budgets: [{ category: 'Food', monthlyLimit: 200 }] }));
    expect(plan.coverage.status).toBe('empty');
    expect(plan.coverage.missingRecentMonths).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(plan.cashflow.recent).toBeNull();
    expect(plan.cashflow.monthlyIncome).toBeNull();
    expect(plan.cashflow.monthlySurplus).toBeNull();
    expect(plan.cashflow.months.every((month) => month.totals == null)).toBe(true);
    expect(plan.balanceSheet.netWorth).toBeNull();
    expect(plan.balanceSheet.cash).toBeNull();
    expect(plan.emergencyFund.status).toBe('unknown');
    expect(plan.budgets[0].status).toBe('unknown');
    expect(plan.budgets[0].remaining).toBeNull();
    expect(plan.recurring).toEqual([]);
    expect(plan.actions[0].id).toBe('complete-history');
  });

  it('uses latest three completed months across year and leap-year boundaries', () => {
    const plan = buildFinancialPlan(input({ asOf: '2024-03-01' }));
    expect(plan.cashflow.recentPeriod).toEqual({ start: '2023-12-01', end: '2024-02-29', months: ['2023-12', '2024-01', '2024-02'] });
    expect(plan.cashflow.previousPeriod).toEqual({ start: '2023-09-01', end: '2023-11-30', months: ['2023-09', '2023-10', '2023-11'] });
  });

  it('excludes the current month and future payments from comparisons', () => {
    const plan = buildFinancialPlan(input({ transactions: [
      ...sixMonths(), transaction(40, '2026-10-01', -9999), transaction(41, '2026-10-12', -8888),
    ] }));
    expect(plan.cashflow.recent?.spending).toBe(600);
    expect(plan.cashflow.monthlySpending).toBe(200);
    expect(plan.coverage.ignoredFutureTransactions).toBe(1);
    expect(plan.coverage.lastTransactionDate).toBe('2026-10-01');
  });

  it('does not divide a single observed month into a fake three-month baseline', () => {
    const plan = buildFinancialPlan(input({ transactions: [transaction(1, '2026-09-10', -300)] }));
    expect(plan.coverage.status).toBe('limited');
    expect(plan.cashflow.recent?.spending).toBe(300);
    expect(plan.cashflow.monthlySpending).toBeNull();
    expect(plan.cashflow.monthlySpendingChange).toBeNull();
    expect(plan.spending.categories[0].monthlyAverage).toBeNull();
    expect(plan.spending.categories[0].previousTotal).toBeNull();
    expect(plan.coverage.warnings.join(' ')).toContain('unknown, not zero');
  });

  it('does not claim complete data simply because all months contain a transaction', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths() }));
    expect(plan.coverage.status).toBe('represented');
    expect(plan.coverage.warnings.join(' ')).toContain('does not confirm a complete statement');
    expect(plan.cashflow.monthlySpendingChange).toBe(100);
    expect(plan.cashflow.monthlySpendingChangePercent).toBe(100);
  });

  it('does not show old categories as zero recent spending when recent history is absent', () => {
    const plan = buildFinancialPlan(input({ transactions: [transaction(1, '2026-04-10', -100, { merchant: 'Old shop' })] }));
    expect(plan.spending.categories).toEqual([]);
    expect(plan.spending.merchants).toEqual([]);
    expect(plan.cashflow.recent).toBeNull();
    expect(plan.cashflow.previous?.spending).toBe(100);
  });

  it('removes transfers and nets explicit refunds against spending without creating income', () => {
    const plan = buildFinancialPlan(input({ transactions: [
      ...sixMonths(),
      transaction(20, '2026-09-02', -500, { isTransfer: true }),
      transaction(21, '2026-09-02', 500, { isTransfer: true }),
      transaction(22, '2026-09-20', 60, { category: 'Food', merchant: 'Grocer', cashflowType: 'refund' }),
    ] }));
    expect(plan.cashflow.recent?.income).toBe(3000);
    expect(plan.cashflow.recent?.spending).toBe(540);
    expect(plan.cashflow.recent?.net).toBe(2460);
    expect(plan.coverage.excludedTransfers).toBe(2);
    expect(plan.spending.categories[0].recentTotal).toBe(540);
    expect(plan.spending.merchants.find((merchant) => merchant.name === 'Grocer')?.recentTotal).toBe(540);
  });

  it('explicitly warns when an unclassified receipt could be a refund', () => {
    const plan = buildFinancialPlan(input({ transactions: [transaction(1, '2026-09-10', 25, { cashflowType: undefined, category: 'Food' })] }));
    expect(plan.cashflow.recent?.income).toBe(25);
    expect(plan.coverage.warnings.join(' ')).toContain('Label refunds explicitly');
  });

  it('separates property outgoings from household spending and personal budgets', () => {
    const plan = buildFinancialPlan(input({
      transactions: [...sixMonths(), transaction(20, '2026-09-20', -900, { propertyId: 2 })],
      budgets: [{ category: 'Food', monthlyLimit: 250 }],
    }));
    expect(plan.cashflow.recent?.personalSpending).toBe(600);
    expect(plan.cashflow.recent?.propertySpending).toBe(900);
    expect(plan.cashflow.monthlyPropertySpending).toBe(300);
    expect(plan.spending.categories[0].personalTotal).toBe(600);
    expect(plan.spending.categories[0].propertyTotal).toBe(900);
    expect(plan.budgets[0].observedMonthlySpending).toBe(200);
    expect(plan.budgets[0].status).toBe('within-budget');
  });

  it('does not fabricate an improvement percentage when the preceding baseline is zero', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths(0, 200) }));
    expect(plan.cashflow.monthlySpendingChange).toBe(200);
    expect(plan.cashflow.monthlySpendingChangePercent).toBeNull();
    expect(plan.spending.categories.find((category) => category.name === 'Food')?.changePercent).toBeNull();
  });

  it('computes a net cashflow ratio and preserves negative surplus', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths(100, 1200) }));
    expect(plan.cashflow.monthlySurplus).toBe(-200);
    expect(plan.cashflow.savingsRate).toBe(-20);
    expect(plan.actions.find((action) => action.id === 'cashflow-deficit')?.amount).toBe(200);
    expect(plan.methodology.join(' ')).toContain('not verified transfers into savings');
  });
});

describe('cash, wealth and emergency resilience', () => {
  it('discloses inferred accessibility in reserve amounts, status, actions and methodology', () => {
    const plan = buildFinancialPlan(input({
      cashAccessibility: 'inferred',
      accounts: [account(1, 1000, { isLiquidCash: true })],
      profile: { essentialMonthlySpending: 1000, emergencyFundMonths: 3 },
    }));
    expect(plan.emergencyFund).toMatchObject({ cashAccessibility: 'inferred', isEstimate: true, cashAvailable: 1000, shortfall: 2000, status: 'below-target' });
    expect(plan.emergencyFund.basis).toContain('not confirmed withdrawal access');
    expect(plan.emergencyFund.basis).toContain('reserve status and shortfall are estimates');
    const action = plan.actions.find((candidate) => candidate.id === 'emergency-shortfall');
    expect(action?.title).toContain('estimated');
    expect(action?.evidence).toContain('Estimated coverage');
    expect(action?.detail).toContain('Verify withdrawal restrictions');
    expect(plan.methodology.join(' ')).toContain('estimated from inferred account classifications');
  });

  it('keeps on-target and unknown inferred reserve states explicitly estimated', () => {
    const onTarget = buildFinancialPlan(input({ cashAccessibility: 'inferred', accounts: [account(1, 5000, { isLiquidCash: true })], profile: { essentialMonthlySpending: 1000 } }));
    expect(onTarget.emergencyFund).toMatchObject({ isEstimate: true, status: 'on-target', shortfall: 0 });
    expect(onTarget.emergencyFund.basis).toContain('reserve status and shortfall are estimates');
    const unknown = buildFinancialPlan(input({ cashAccessibility: 'inferred' }));
    expect(unknown.emergencyFund).toMatchObject({ isEstimate: true, status: 'unknown', cashAvailable: null });
    expect(unknown.emergencyFund.basis).toContain('not confirmed withdrawal access');
  });

  it('defaults explicitly supplied cash classifications to confirmed without inventing a reserve target', () => {
    const plan = buildFinancialPlan(input({ accounts: [account(1, 500, { isLiquidCash: true })] }));
    expect(plan.emergencyFund).toMatchObject({ cashAccessibility: 'confirmed', isEstimate: false, status: 'unknown', targetAmount: null });
    expect(plan.emergencyFund.basis).toContain('explicitly classified');
  });
  it('never treats pensions or unknown assets as emergency cash even if marked liquid', () => {
    const plan = buildFinancialPlan(input({
      accounts: [
        account(1, 2500, { isLiquidCash: true }),
        account(2, 50000, { isInvestment: true, investmentKind: 'pension', isLiquidCash: true }),
        account(3, 5000, { isInvestment: true, investmentKind: 'stocks_isa' }),
        account(4, 10000),
      ],
      profile: { essentialMonthlySpending: 1000, emergencyFundMonths: 6 },
    }));
    expect(plan.balanceSheet.cash).toBe(2500);
    expect(plan.balanceSheet.pensions).toBe(50000);
    expect(plan.balanceSheet.investments).toBe(5000);
    expect(plan.balanceSheet.unclassifiedAssets).toBe(1);
    expect(plan.emergencyFund.cashAvailable).toBe(2500);
    expect(plan.emergencyFund.coverageMonths).toBe(2.5);
    expect(plan.emergencyFund.targetAmount).toBe(6000);
    expect(plan.emergencyFund.shortfall).toBe(3500);
    expect(plan.emergencyFund.status).toBe('below-target');
  });

  it('keeps coverage unknown if essential spending is absent or zero', () => {
    for (const profile of [{}, { essentialMonthlySpending: 0 }]) {
      const plan = buildFinancialPlan(input({ accounts: [account(1, 1000, { isLiquidCash: true })], profile }));
      expect(plan.emergencyFund.status).toBe('unknown');
      expect(plan.emergencyFund.coverageMonths).toBeNull();
      expect(plan.emergencyFund.targetAmount).toBeNull();
    }
  });

  it('requires explicit cash classification instead of trusting account names or generic asset types', () => {
    const plan = buildFinancialPlan(input({ accounts: [account(1, 50000, { name: 'Cash-looking property account' })], profile: { essentialMonthlySpending: 1000 } }));
    expect(plan.balanceSheet.netWorth).toBe(50000);
    expect(plan.emergencyFund.cashAvailable).toBeNull();
    expect(plan.emergencyFund.status).toBe('unknown');
  });

  it('preserves known zero cash and cannot give negative reserve coverage from an overdraft', () => {
    const zero = buildFinancialPlan(input({ accounts: [account(1, 0, { isLiquidCash: true })], profile: { essentialMonthlySpending: 1000 } }));
    expect(zero.emergencyFund.coverageMonths).toBe(0);
    expect(zero.emergencyFund.status).toBe('below-target');
    const overdraft = buildFinancialPlan(input({ accounts: [account(1, -500, { isLiquidCash: true })], profile: { essentialMonthlySpending: 1000 } }));
    expect(overdraft.balanceSheet.cash).toBe(-500);
    expect(overdraft.balanceSheet.totalDebt).toBe(500);
    expect(overdraft.balanceSheet.knownAssets).toBe(0);
    expect(overdraft.balanceSheet.netWorth).toBe(-500);
    expect(overdraft.emergencyFund.cashAvailable).toBe(0);
    expect(overdraft.emergencyFund.coverageMonths).toBe(0);
  });

  it('uses signed liability balances and keeps credit-card overpayments out of debt and emergency cash', () => {
    const plan = buildFinancialPlan(input({ accounts: [
      account(1, 5000, { isLiquidCash: true }),
      account(2, -1000, { accountType: 'LIABILITY' }),
      account(3, 100, { accountType: 'LIABILITY' }),
    ] }));
    expect(plan.balanceSheet.totalDebt).toBe(1000);
    expect(plan.balanceSheet.knownAssets).toBe(5100);
    expect(plan.balanceSheet.netWorth).toBe(4100);
    expect(plan.emergencyFund.cashAvailable).toBe(5000);
  });

  it('does not turn expense/income accounts into a zero-valued balance sheet', () => {
    const plan = buildFinancialPlan(input({ accounts: [account(1, 1000, { accountType: 'INCOME' }), account(2, 500, { accountType: 'EXPENSE' })] }));
    expect(plan.balanceSheet.knownAssets).toBeNull();
    expect(plan.balanceSheet.totalDebt).toBeNull();
    expect(plan.balanceSheet.netWorth).toBeNull();
  });

  it('counts property values, mortgages and investment balances once when supplied as separate sources', () => {
    const plan = buildFinancialPlan(input({
      accounts: [account(1, 10000, { isLiquidCash: true }), account(2, 20000, { isInvestment: true, investmentKind: 'sipp' }), account(3, -500, { accountType: 'LIABILITY' })],
      properties: [{ id: 1, name: 'Flat', value: 200000, debt: 120000, monthlyRent: 1000, monthlyCosts: 600 }],
    }));
    expect(plan.balanceSheet.knownAssets).toBe(230000);
    expect(plan.balanceSheet.totalDebt).toBe(120500);
    expect(plan.balanceSheet.netWorth).toBe(109500);
    expect(plan.balanceSheet.propertyEquity).toBe(80000);
    expect(plan.balanceSheet.propertySharePercent).toBe(86.96);
    expect(plan.actions.some((action) => action.id === 'property-concentration')).toBe(true);
  });
});

describe('recurring payment evidence', () => {
  it('identifies a consistent monthly candidate and never labels it a confirmed subscription or saving', () => {
    const payments = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'].map((month, index) => transaction(index, `${month}-10`, -12.99, { merchant: 'Video service', category: 'Entertainment' }));
    const plan = buildFinancialPlan(input({ transactions: payments }));
    expect(plan.recurring).toHaveLength(1);
    expect(plan.recurring[0]).toMatchObject({ merchant: 'Video service', typicalPayment: 12.99, observedTotal: 77.94, paymentCount: 6, confidence: 'high', needsConfirmation: true });
    expect(plan.recurring[0].evidence).toContain('Confirm the agreement');
    expect(plan.actions.find((action) => action.id === 'review-recurring')?.amount).toBeNull();
  });

  it('rejects frequent ordinary purchases, uneven amounts, one-off repeats and missing merchant evidence', () => {
    const regularDates = ['2026-07-10', '2026-08-10', '2026-09-10'];
    const cases = [
      regularDates.flatMap((date, index) => [transaction(index * 2, date, -20, { merchant: 'Supermarket' }), transaction(index * 2 + 1, date.replace('-10', '-20'), -20, { merchant: 'Supermarket' })]),
      regularDates.map((date, index) => transaction(index, date, -[10, 50, 100][index], { merchant: 'Shop' })),
      ['2026-07-01', '2026-08-20', '2026-09-28'].map((date, index) => transaction(index, date, -20, { merchant: 'Shop' })),
      regularDates.map((date, index) => transaction(index, date, -20, { description: 'Looks like subscription' })),
    ];
    for (const transactions of cases) expect(buildFinancialPlan(input({ transactions })).recurring).toEqual([]);
  });

  it('excludes transfer and property rent/cost patterns from personal payment candidates', () => {
    const payments = ['2026-07', '2026-08', '2026-09'].flatMap((month, index) => [
      transaction(index * 2, `${month}-10`, -500, { merchant: 'My bank', isTransfer: true }),
      transaction(index * 2 + 1, `${month}-10`, -500, { merchant: 'Mortgage provider', propertyId: 1 }),
    ]);
    expect(buildFinancialPlan(input({ transactions: payments })).recurring).toEqual([]);
  });
});

describe('budgets, properties and conservative actions', () => {
  it('shows a budget gap as evidence to review, never as a promised saving', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths(), budgets: [{ category: 'Food', monthlyLimit: 150 }] }));
    expect(plan.budgets[0]).toMatchObject({ observedMonthlySpending: 200, remaining: -50, status: 'over-budget', utilisationPercent: 133.33 });
    expect(plan.actions.find((action) => action.id === 'budget-Food')).toMatchObject({ amount: 50 });
    expect(plan.actions.find((action) => action.id === 'budget-Food')?.detail).toContain('not a guaranteed saving');
  });

  it('keeps budgets without matched personal spending unknown even when other months have entries', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths(), budgets: [{ category: 'Travel', monthlyLimit: 0 }] }));
    expect(plan.budgets[0]).toMatchObject({ observedMonthlySpending: null, remaining: null, utilisationPercent: null, status: 'unknown' });
  });

  it('rolls personal child-category spending and refunds into an ID-based parent budget', () => {
    const transactions = ['2026-07', '2026-08', '2026-09'].flatMap((month, index) => [
      transaction(index * 3, `${month}-10`, -100, { category: 'Groceries', categoryId: 20, categoryAncestorIds: [20, 10] }),
      transaction(index * 3 + 1, `${month}-15`, 20, { category: 'Groceries', categoryId: 20, categoryAncestorIds: [20, 10], cashflowType: 'refund' }),
      transaction(index * 3 + 2, `${month}-20`, -500, { category: 'Groceries', categoryId: 20, categoryAncestorIds: [20, 10], propertyId: 1 }),
    ]);
    const plan = buildFinancialPlan(input({ transactions, budgets: [{ category: 'Household', categoryId: 10, monthlyLimit: 100 }] }));
    expect(plan.budgets[0]).toMatchObject({ categoryId: 10, observedMonthlySpending: 80, remaining: 20, status: 'within-budget' });
    expect(plan.spending.categories[0].categoryId).toBe(20);
  });

  it('keeps identically named categories and budgets separate by stable IDs', () => {
    const transactions = ['2026-07', '2026-08', '2026-09'].flatMap((month, index) => [
      transaction(index * 2, `${month}-10`, -100, { category: 'Utilities', categoryId: 11 }),
      transaction(index * 2 + 1, `${month}-15`, -200, { category: 'Utilities', categoryId: 22 }),
    ]);
    const plan = buildFinancialPlan(input({ transactions, budgets: [{ category: 'Utilities', categoryId: 11, monthlyLimit: 50 }, { category: 'Utilities', categoryId: 22, monthlyLimit: 150 }] }));
    expect(plan.spending.categories).toHaveLength(2);
    expect(plan.spending.categories.map((category) => [category.categoryId, category.recentTotal])).toEqual([[22, 600], [11, 300]]);
    expect(plan.budgets.map((budget) => [budget.categoryId, budget.observedMonthlySpending])).toEqual([[11, 100], [22, 200]]);
    expect(plan.actions.filter((action) => action.id.startsWith('budget-')).map((action) => action.id)).toEqual(['budget-11', 'budget-22']);
  });

  it('rejects duplicate budget IDs even when their display names differ', () => {
    expect(() => buildFinancialPlan(input({ budgets: [{ category: 'A', categoryId: 1, monthlyLimit: 100 }, { category: 'B', categoryId: 1, monthlyLimit: 200 }] }))).toThrow(PlanningValidationError);
  });

  it('computes negative property equity, gross yield and a clearly limited reserve', () => {
    const plan = buildFinancialPlan(input({ properties: [{ id: 1, name: 'Flat', value: 100000, debt: 110000, monthlyRent: 800, monthlyCosts: 1000 }] }));
    expect(plan.properties[0]).toMatchObject({ equity: -10000, loanToValuePercent: 110, grossYieldPercent: 9.6, monthlyOperatingSurplus: -200, threeMonthCostReserve: 3000, observedIncome: null, observedSpending: null });
    expect(plan.actions.find((action) => action.id === 'property-cashflow-1')?.priority).toBe('high');
    expect(plan.properties[0].warnings.join(' ')).toContain('not a tax profit');
  });

  it('exposes missing valuations and costs rather than fabricating yield, equity or operating surplus', () => {
    const plan = buildFinancialPlan(input({ properties: [{ id: 1, name: 'Flat', value: null, debt: 100000, monthlyRent: 800, monthlyCosts: null }] }));
    expect(plan.properties[0]).toMatchObject({ equity: null, loanToValuePercent: null, grossYieldPercent: null, monthlyOperatingSurplus: null, threeMonthCostReserve: null });
    expect(plan.balanceSheet.propertyValue).toBeNull();
    expect(plan.balanceSheet.propertyEquity).toBeNull();
    expect(plan.balanceSheet.missingPropertyValuations).toBe(1);
    expect(plan.actions.some((action) => action.id === 'property-valuations')).toBe(true);
  });

  it('requests missing investment suitability facts and never infers an allocation from balances', () => {
    const plan = buildFinancialPlan(input({ accounts: [account(1, 50000, { isInvestment: true, investmentKind: 'isa' })] }));
    expect(plan.actions.find((action) => action.id === 'investment-profile')?.evidence).toContain('cannot be inferred');
    expect(plan.actions.some((action) => action.id === 'review-investments')).toBe(false);
    const configured = buildFinancialPlan(input({ profile: { investmentHorizonYears: 10, riskTolerance: 'medium' } }));
    expect(configured.actions.find((action) => action.id === 'review-investments')?.evidence).toContain('No security or portfolio allocation is recommended');
  });

  it('orders urgent evidence before generic investing and pension reviews', () => {
    const plan = buildFinancialPlan(input({ transactions: sixMonths(100, 1200), accounts: [account(1, -1000, { accountType: 'LIABILITY' })] }));
    const priorities = plan.actions.map((action) => ({ high: 0, medium: 1, low: 2 })[action.priority]);
    expect(priorities).toEqual([...priorities].sort());
    expect(plan.actions.find((action) => action.id === 'review-debt')?.evidence).toContain('no repayment ranking');
    expect(plan.actions.find((action) => action.id === 'review-debt')).toMatchObject({ href: '/chat', actionLabel: 'Discuss debt commitments' });
    expect(plan.actions.find((action) => action.id === 'review-debt')?.detail).toContain('lender statements');
  });

  it('keeps a personal retirement illustration unknown without a scenario pot, even if household pensions are recorded', () => {
    const plan = buildFinancialPlan(input({ accounts: [account(1, 10000, { isInvestment: true, investmentKind: 'pension' })], profile: { currentAge: 40, retirementAge: 60, monthlyPensionContribution: 100, statePensionAnnual: 9000 } }));
    expect(plan.retirement.yearsToRetirement).toBe(20);
    expect(plan.retirement.contributionsOnlyAtRetirement).toBeNull();
    expect(plan.retirement.scenarioPot).toBeNull();
    expect(plan.retirement.projectionScope).toBe('unavailable');
    expect(plan.retirement.basis).toContain('not verified entitlements');
    expect(plan.emergencyFund.cashAvailable).toBeNull();
  });

  it('uses only a personal scenario pot in retirement illustrations and keeps household pension wealth separate', () => {
    const retirementScenario: RetirementInput = {
      currentAge: 40, retirementAge: 60, currentPot: 10000,
      monthlyContribution: 75, monthlyEmployerContribution: 25,
      annualGrowthRate: 5, annualFeeRate: 0.5, inflationRate: 2,
      desiredAnnualIncome: 20000, expectedAnnualStatePension: 9000,
      statePensionAge: 68, withdrawalRate: 4, sensitivitySpread: 2,
    };
    const accounts = [
      account(1, 10000, { ownerId: 1, isInvestment: true, investmentKind: 'pension' }),
      account(2, 90000, { ownerId: 2, isInvestment: true, investmentKind: 'pension' }),
    ];
    const plan = buildFinancialPlan(input({ accounts, profile: { retirementScenario } }));
    expect(plan.retirement).toMatchObject({ pensionValue: 100000, scenarioPot: 10000, projectionScope: 'personal-scenario', currentAge: 40, retirementAge: 60, monthlyContribution: 100, targetAnnualIncome: 20000, statePensionAnnual: 9000, contributionsOnlyAtRetirement: 34000 });
    expect(plan.retirement.basis).toContain('never uses the household pension total');
    const noRecordedPension = buildFinancialPlan(input({ profile: { retirementScenario } }));
    expect(noRecordedPension.retirement.pensionValue).toBeNull();
    expect(noRecordedPension.retirement.contributionsOnlyAtRetirement).toBe(34000);
    const staleFlatProfile = buildFinancialPlan(input({ accounts, profile: { retirementScenario, currentAge: 70, monthlyPensionContribution: 9999 } }));
    expect(staleFlatProfile.retirement.currentAge).toBe(40);
    expect(staleFlatProfile.retirement.monthlyContribution).toBe(100);
    expect(staleFlatProfile.retirement.contributionsOnlyAtRetirement).toBe(34000);
  });
});

describe('validated, stable money calculations', () => {
  it('uses decimal money arithmetic for cashflow, refunds, account totals and property differences', () => {
    const plan = buildFinancialPlan(input({
      transactions: [transaction(1, '2026-07-10', -0.1), transaction(2, '2026-08-10', -0.2), transaction(3, '2026-09-10', 0.1, { cashflowType: 'refund', category: 'Food' })],
      accounts: [account(1, 0.1, { isLiquidCash: true }), account(2, 0.2, { isLiquidCash: true })],
      properties: [{ id: 1, name: 'Flat', value: 100.1, debt: 100, monthlyRent: 0.3, monthlyCosts: 0.1 }],
    }));
    expect(plan.cashflow.recent?.spending).toBe(0.2);
    expect(plan.cashflow.monthlySpending).toBe(0.07);
    expect(plan.balanceSheet.cash).toBe(0.3);
    expect(plan.properties[0].equity).toBe(0.1);
    expect(plan.properties[0].monthlyOperatingSurplus).toBe(0.2);
  });

  it('rejects invalid dates, nonfinite amounts, impossible profile inputs and duplicate records', () => {
    const cases: PlanningInput[] = [
      input({ asOf: '2026-02-30' }),
      input({ asOf: '0000-01-01' }),
      input({ transactions: [transaction(1, '2026-09-31', -10)] }),
      input({ transactions: [transaction(1, '2026-09-01', Number.NaN)] }),
      input({ transactions: [transaction(1, '2026-09-01', Number.POSITIVE_INFINITY)] }),
      input({ transactions: [transaction(1, '2026-09-01', -10), transaction(1, '2026-09-02', -10)] }),
      input({ transactions: [transaction(1, '2026-09-01', -10, { cashflowType: 'refund' })] }),
      input({ accounts: [account(1, 100), account(1, 200)] }),
      input({ budgets: [{ category: 'Food', monthlyLimit: -1 }] }),
      input({ budgets: [{ category: 'Food', monthlyLimit: 1 }, { category: ' food ', monthlyLimit: 2 }] }),
      input({ profile: { essentialMonthlySpending: -1 } }),
      input({ profile: { currentAge: 60, retirementAge: 40 } }),
      input({ profile: { emergencyFundMonths: 0 } }),
      input({ profile: { riskTolerance: 'impossible' as 'low' } }),
      input({ cashAccessibility: 'unknown' as 'inferred' }),
    ];
    for (const candidate of cases) expect(() => buildFinancialPlan(candidate)).toThrow(PlanningValidationError);
  });

  it('rejects aggregates that cannot preserve penny precision in numeric outputs', () => {
    const accounts = Array.from({ length: 100 }, (_, index) => account(index, 1e12));
    expect(() => buildFinancialPlan(input({ accounts }))).toThrow('supported precision');
  });

  it('is deterministic and does not mutate the supplied input', () => {
    const source = input({ transactions: sixMonths(), accounts: [account(1, 2000, { isLiquidCash: true })], profile: { essentialMonthlySpending: 1000 } });
    const before = structuredClone(source);
    expect(buildFinancialPlan(source)).toEqual(buildFinancialPlan(source));
    expect(source).toEqual(before);
  });
});
