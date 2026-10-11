import Decimal from 'decimal.js';
import { retirementInputSchema } from '@/lib/retirement/projection';
import type {
  BudgetProgress, CashflowTotals, FinancialPlan, PlanningAction, PlanningInput,
  PlanningPeriod, PlanningProfile, PlanningReference, PlanningTransaction,
  PropertyPlan, RecurringCandidate, SpendingComparison,
} from './types';

// Do not modify Decimal's shared global configuration used by tax calculations.
const Money = Decimal.clone({ precision: 32, rounding: Decimal.ROUND_HALF_UP });
const pounds = (value: Decimal.Value): number => {
  const amount = new Money(value).toDecimalPlaces(2);
  if (!amount.isFinite() || amount.abs().times(100).gt(Number.MAX_SAFE_INTEGER)) invalid('Calculated GBP amount exceeds supported precision');
  return amount.toNumber();
};
const add = (values: Decimal.Value[]): number => pounds(values.reduce<Decimal>((sum, value) => sum.plus(value), new Money(0)));
const subtract = (a: number, b: number): number => pounds(new Money(a).minus(b));
const divide = (a: number, b: number): number => pounds(new Money(a).div(b));
const percent = (a: number, b: number): number | null => b > 0 ? pounds(new Money(a).div(b).times(100)) : null;
const gbp = (amount: number): string => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(amount);

export class PlanningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningValidationError';
  }
}

function invalid(message: string): never {
  throw new PlanningValidationError(message);
}

function validDate(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid(`${field} must be an ISO calendar date`);
  if (value.slice(0, 4) === '0000') invalid(`${field} must use a calendar year from 0001 to 9999`);
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) invalid(`${field} is not a valid calendar date`);
  return value;
}

function validMoney(value: unknown, field: string, nonnegative = false): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) invalid(`${field} must be a finite GBP amount within supported limits`);
  if (nonnegative && value < 0) invalid(`${field} cannot be negative`);
}

function validate(input: PlanningInput): void {
  validDate(input.asOf, 'asOf');
  if (input.cashAccessibility != null && !['inferred', 'confirmed'].includes(input.cashAccessibility)) invalid('Cash accessibility classification is invalid');
  for (const key of ['transactions', 'accounts', 'properties', 'budgets'] as const) {
    if (!Array.isArray(input[key])) invalid(`${key} must be an array`);
  }
  const transactionIds = new Set<string>();
  for (const transaction of input.transactions) {
    const id = String(transaction.id);
    if (!id || transaction.id == null || transactionIds.has(id)) invalid('Transactions must have unique identifiers');
    transactionIds.add(id);
    validDate(transaction.date, `Transaction ${id} date`);
    validMoney(transaction.amount, `Transaction ${id} amount`);
    if (typeof transaction.category !== 'string' || !transaction.category.trim()) invalid(`Transaction ${id} needs a category`);
    if (transaction.categoryId != null && !Number.isInteger(transaction.categoryId)) invalid(`Transaction ${id} has an invalid category identifier`);
    if (transaction.categoryAncestorIds != null && (!Array.isArray(transaction.categoryAncestorIds) || transaction.categoryAncestorIds.some((ancestor) => !Number.isInteger(ancestor)))) invalid(`Transaction ${id} has invalid category ancestry`);
    if (typeof transaction.description !== 'string') invalid(`Transaction ${id} needs a description`);
    if (transaction.cashflowType != null && !['income', 'expense', 'refund'].includes(transaction.cashflowType)) invalid(`Transaction ${id} has an invalid cashflow type`);
    if (transaction.cashflowType === 'refund' && transaction.amount < 0) invalid(`Transaction ${id} refund cannot be negative`);
  }
  const accountIds = new Set<number>();
  for (const account of input.accounts) {
    if (!Number.isInteger(account.id) || accountIds.has(account.id)) invalid('Accounts must have unique integer identifiers');
    accountIds.add(account.id);
    if (!['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'].includes(account.accountType)) invalid(`Account ${account.id} has an invalid account type`);
    validMoney(account.balance, `Account ${account.id} balance`);
  }
  const propertyIds = new Set<number>();
  for (const property of input.properties) {
    if (!Number.isInteger(property.id) || propertyIds.has(property.id)) invalid('Properties must have unique integer identifiers');
    propertyIds.add(property.id);
    if (property.value != null) validMoney(property.value, `Property ${property.id} value`, true);
    validMoney(property.debt, `Property ${property.id} debt`, true);
    if (property.monthlyRent != null) validMoney(property.monthlyRent, `Property ${property.id} rent`, true);
    if (property.monthlyCosts != null) validMoney(property.monthlyCosts, `Property ${property.id} costs`, true);
  }
  const budgetCategories = new Set<string>();
  for (const budget of input.budgets) {
    if (typeof budget.category !== 'string' || !budget.category.trim()) invalid('A budget needs a category');
    if (budget.categoryId != null && !Number.isInteger(budget.categoryId)) invalid(`Budget ${budget.category} has an invalid category identifier`);
    const category = budget.categoryId != null ? `id:${budget.categoryId}` : `name:${budget.category.trim().toLocaleLowerCase('en-GB')}`;
    if (budgetCategories.has(category)) invalid('Only one budget per category is supported');
    budgetCategories.add(category);
    validMoney(budget.monthlyLimit, `Budget ${budget.category} limit`, true);
  }
  const profile = input.profile ?? {};
  for (const field of ['essentialMonthlySpending', 'monthlySavingsTarget', 'monthlyPensionContribution', 'targetRetirementIncome', 'statePensionAnnual'] as const) {
    if (profile[field] != null) validMoney(profile[field], `Profile ${field}`, true);
  }
  for (const field of ['emergencyFundMonths', 'investmentHorizonYears', 'currentAge', 'retirementAge'] as const) {
    const value = profile[field];
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > (field === 'emergencyFundMonths' ? 36 : 120))) invalid(`Profile ${field} is outside its supported range`);
  }
  if (profile.emergencyFundMonths != null && profile.emergencyFundMonths < 1) invalid('Emergency fund target must be at least one month');
  if (profile.currentAge != null && profile.retirementAge != null && profile.retirementAge < profile.currentAge) invalid('Target retirement age cannot be earlier than current age');
  if (profile.riskTolerance != null && !['low', 'medium', 'high'].includes(profile.riskTolerance)) invalid('Profile risk tolerance is invalid');
  if (profile.retirementScenario != null && !retirementInputSchema.safeParse(profile.retirementScenario).success) invalid('Saved retirement scenario is invalid');
}

function monthAt(asOf: string, offset: number): string {
  const date = new Date(`${asOf.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}

function period(months: string[]): PlanningPeriod {
  const endDate = new Date(`${months.at(-1)}-01T00:00:00.000Z`);
  endDate.setUTCMonth(endDate.getUTCMonth() + 1);
  endDate.setUTCDate(0);
  return { start: `${months[0]}-01`, end: endDate.toISOString().slice(0, 10), months };
}

function isIncome(transaction: PlanningTransaction): boolean {
  return transaction.cashflowType === 'income' || (transaction.cashflowType == null && transaction.amount > 0);
}

function totals(transactions: PlanningTransaction[]): CashflowTotals | null {
  if (!transactions.length) return null;
  const income = add(transactions.filter(isIncome).map((transaction) => transaction.amount));
  const spendingTransactions = transactions.filter((transaction) => !isIncome(transaction));
  const spending = add(spendingTransactions.map((transaction) => new Money(transaction.amount).negated()));
  return {
    income,
    spending,
    net: subtract(income, spending),
    personalSpending: add(spendingTransactions.filter((transaction) => transaction.propertyId == null).map((transaction) => new Money(transaction.amount).negated())),
    propertySpending: add(spendingTransactions.filter((transaction) => transaction.propertyId != null).map((transaction) => new Money(transaction.amount).negated())),
    transactionCount: transactions.length,
  };
}

function comparison(
  recent: PlanningTransaction[], previous: PlanningTransaction[], group: 'category' | 'merchant',
  recentRepresented: boolean, previousRepresented: boolean,
): SpendingComparison[] {
  if (!recent.length) return [];
  const key = (transaction: PlanningTransaction) => group === 'category' ? transaction.category.trim() : (transaction.merchant?.trim() || transaction.description.trim() || 'Unknown merchant');
  const recentSpend = recent.filter((transaction) => !isIncome(transaction));
  const previousSpend = previous.filter((transaction) => !isIncome(transaction));
  const groups = new Map<string, { name: string; categoryId?: number | null; recent: PlanningTransaction[]; previous: PlanningTransaction[] }>();
  for (const [side, transactions] of [['recent', recentSpend], ['previous', previousSpend]] as const) {
    for (const transaction of transactions) {
      const name = key(transaction);
      const id = group === 'category' && transaction.categoryId != null ? `id:${transaction.categoryId}` : `name:${name.toLocaleLowerCase('en-GB')}`;
      // Without a recent baseline, do not manufacture zero observations for
      // categories/merchants that only occur in the previous period.
      if (side === 'previous' && !recentRepresented && !groups.has(id)) continue;
      const bucket = groups.get(id) ?? { name, categoryId: group === 'category' ? transaction.categoryId : undefined, recent: [], previous: [] };
      bucket[side].push(transaction);
      groups.set(id, bucket);
    }
  }
  const positiveTotal = add([...groups.values()].map((bucket) => Math.max(0, add(bucket.recent.map((transaction) => new Money(transaction.amount).negated())))));
  return [...groups.values()].map((bucket) => {
    const recentTotal = add(bucket.recent.map((transaction) => new Money(transaction.amount).negated()));
    // An absent category in a represented period is an observed zero, not proof there was no spending.
    const previousTotal = previous.length ? add(bucket.previous.map((transaction) => new Money(transaction.amount).negated())) : null;
    const monthlyAverage = recentRepresented ? divide(recentTotal, 3) : null;
    const previousMonthlyAverage = previousRepresented && previousTotal != null ? divide(previousTotal, 3) : null;
    const monthlyChange = monthlyAverage != null && previousMonthlyAverage != null ? subtract(monthlyAverage, previousMonthlyAverage) : null;
    return {
      name: bucket.name, categoryId: bucket.categoryId, recentTotal, previousTotal, monthlyAverage, previousMonthlyAverage, monthlyChange,
      changePercent: monthlyChange != null && previousMonthlyAverage != null ? percent(monthlyChange, previousMonthlyAverage) : null,
      transactionCount: bucket.recent.length,
      sharePercent: percent(Math.max(0, recentTotal), positiveTotal),
      personalTotal: add(bucket.recent.filter((transaction) => transaction.propertyId == null).map((transaction) => new Money(transaction.amount).negated())),
      propertyTotal: add(bucket.recent.filter((transaction) => transaction.propertyId != null).map((transaction) => new Money(transaction.amount).negated())),
    };
  }).sort((a, b) => b.recentTotal - a.recentTotal || a.name.localeCompare(b.name, 'en-GB'));
}

function recurringCandidates(transactions: PlanningTransaction[], recentMonths: string[]): RecurringCandidate[] {
  const groups = new Map<string, PlanningTransaction[]>();
  // Require a recorded merchant; descriptions alone frequently contain ambiguous transfers.
  for (const transaction of transactions) {
    if (isIncome(transaction) || transaction.amount >= 0 || transaction.propertyId != null || !transaction.merchant?.trim()) continue;
    const key = transaction.merchant.trim().toLocaleLowerCase('en-GB');
    const bucket = groups.get(key) ?? [];
    bucket.push(transaction);
    groups.set(key, bucket);
  }
  const candidates: RecurringCandidate[] = [];
  for (const payments of groups.values()) {
    payments.sort((a, b) => a.date.localeCompare(b.date));
    const monthlyCounts = new Map<string, number>();
    for (const payment of payments) monthlyCounts.set(payment.date.slice(0, 7), (monthlyCounts.get(payment.date.slice(0, 7)) ?? 0) + 1);
    if (payments.length < 3 || !recentMonths.every((month) => monthlyCounts.get(month) === 1) || [...monthlyCounts.values()].some((count) => count !== 1)) continue;
    const intervals = payments.slice(1).map((payment, index) => (Date.parse(`${payment.date}T00:00:00Z`) - Date.parse(`${payments[index].date}T00:00:00Z`)) / 86400000);
    if (intervals.some((days) => days < 25 || days > 35)) continue;
    const amounts = payments.map((payment) => pounds(new Money(payment.amount).abs())).sort((a, b) => a - b);
    const typicalPayment = amounts.length % 2 ? amounts[Math.floor(amounts.length / 2)] : divide(add([amounts[amounts.length / 2 - 1], amounts[amounts.length / 2]]), 2);
    if (typicalPayment <= 0 || new Money(amounts.at(-1)!).minus(amounts[0]).div(typicalPayment).gt(0.1)) continue;
    candidates.push({
      merchant: payments[0].merchant!.trim(), category: payments[0].category, cadence: 'monthly',
      confidence: payments.length >= 5 ? 'high' : 'medium', typicalPayment,
      observedTotal: add(amounts), paymentCount: payments.length, dates: payments.map((payment) => payment.date),
      amountRange: { min: amounts[0], max: amounts.at(-1)! },
      evidence: `${payments.length} payments, one per observed month, ${Math.min(...intervals)}–${Math.max(...intervals)} days apart. Confirm the agreement and cancellation terms before treating this as a subscription.`,
      needsConfirmation: true,
    });
  }
  return candidates.sort((a, b) => b.typicalPayment - a.typicalPayment || a.merchant.localeCompare(b.merchant, 'en-GB'));
}

export const PLANNING_REFERENCES: Record<string, PlanningReference> = {
  budget: { label: 'MoneyHelper: budget planner', url: 'https://www.moneyhelper.org.uk/en/everyday-money/budgeting/budget-planner' },
  debt: { label: 'MoneyHelper: dealing with debt', url: 'https://www.moneyhelper.org.uk/en/money-troubles/dealing-with-debt' },
  emergency: { label: 'MoneyHelper: emergency savings', url: 'https://www.moneyhelper.org.uk/en/savings/types-of-savings/emergency-savings-how-much-is-enough' },
  investing: { label: 'FCA: investing', url: 'https://www.fca.org.uk/investsmart' },
  diversification: { label: 'FCA: diversification', url: 'https://www.fca.org.uk/investsmart/diversification' },
  pension: { label: 'GOV.UK: State Pension forecast', url: 'https://www.gov.uk/check-state-pension' },
  pensionTracing: { label: 'GOV.UK: find pension contact details', url: 'https://www.gov.uk/find-pension-contact-details' },
  landlord: { label: 'GOV.UK: renting out your property', url: 'https://www.gov.uk/renting-out-a-property' },
};

function buildActions(plan: Omit<FinancialPlan, 'actions'>, profile: PlanningProfile): PlanningAction[] {
  const actions: PlanningAction[] = [];
  const push = (action: PlanningAction) => actions.push(action);
  if (plan.coverage.status !== 'represented') push({
    id: 'complete-history', priority: 'high', topic: 'data', title: 'Build a reliable spending baseline',
    detail: 'Import or connect every spending account for the latest three completed months. Reconcile transfers and refunds before making budget decisions.',
    evidence: `${plan.coverage.recentMonthsWithData} of 3 recent months contain recorded activity. Missing months are not zero-spend months.`,
    href: '/import', actionLabel: 'Import statements', references: [], amount: null,
  });
  if (plan.balanceSheet.totalDebt != null && plan.balanceSheet.totalDebt > 0) push({
    id: 'review-debt', priority: 'high', topic: 'debt', title: 'Review debt costs and repayment priorities',
    detail: 'Check each interest rate, required payment and any arrears against lender statements, then discuss those commitments with the adviser. Keep priority bills and required payments current before comparing other borrowing. Mortgage debt is included in the recorded total; its presence alone does not mean it should be overpaid.',
    evidence: `${gbp(plan.balanceSheet.totalDebt)} of recorded debt. Rates, arrears and repayment penalties are not available, so no repayment ranking is inferred.`,
    href: '/chat', actionLabel: 'Discuss debt commitments', references: [PLANNING_REFERENCES.debt], amount: plan.balanceSheet.totalDebt,
  });
  if (plan.emergencyFund.status === 'unknown') push({
    id: 'emergency-inputs', priority: 'high', topic: 'emergency', title: 'Set essential spending and confirm accessible cash',
    detail: 'Enter the monthly amount needed for housing, food, utilities, transport and required debt payments. Confirm which balances are accessible cash, then choose a reserve suited to your household and property risks.',
    evidence: plan.emergencyFund.basis,
    href: '/plan', actionLabel: 'Complete your plan', references: [PLANNING_REFERENCES.emergency], amount: null,
  });
  else if (plan.emergencyFund.status === 'below-target') push({
    id: 'emergency-shortfall', priority: 'high', topic: 'emergency', title: plan.emergencyFund.isEstimate ? 'Review your estimated cash reserve shortfall' : 'Rebuild your accessible cash reserve',
    detail: `${plan.emergencyFund.isEstimate ? 'Cash accessibility is inferred from account names and tags. Verify withdrawal restrictions and earmarked money first. ' : ''}Set a regular transfer to an accessible savings account that fits your budget and debt obligations. Pension and market investments are excluded from this reserve.`,
    evidence: `${plan.emergencyFund.isEstimate ? 'Estimated coverage: ' : 'Coverage: '}${plan.emergencyFund.coverageMonths} months of entered essential outgoings; ${plan.emergencyFund.targetMonths}-month planning target${plan.emergencyFund.isEstimate ? '. The estimated shortfall depends on unverified cash accessibility' : ''}.`,
    href: '/plan', actionLabel: 'Review reserve target', references: [PLANNING_REFERENCES.emergency], amount: plan.emergencyFund.shortfall,
  });
  if (plan.cashflow.monthlySurplus != null && plan.cashflow.monthlySurplus < 0) push({
    id: 'cashflow-deficit', priority: 'high', topic: 'spending', title: 'Address the recorded cashflow shortfall',
    detail: 'Review the largest cash outgoings and required payments before adding new saving or investing commitments. Check whether property costs or unusual purchases explain the deficit.',
    evidence: `Observed monthly cashflow is ${gbp(plan.cashflow.monthlySurplus)} across the latest three completed months, before saving and investing transfers.`,
    href: '/transactions', actionLabel: 'Review transactions', references: [PLANNING_REFERENCES.budget], amount: Math.abs(plan.cashflow.monthlySurplus),
  });
  const overspent = plan.budgets.filter((budget) => budget.status === 'over-budget').sort((a, b) => (a.remaining ?? 0) - (b.remaining ?? 0));
  for (const budget of overspent.slice(0, 3)) push({
    id: `budget-${budget.categoryId ?? budget.category}`, priority: 'medium', topic: 'spending', title: `Review your ${budget.category} budget`,
    detail: 'Check the recorded purchases, distinguish essentials from optional spending, and decide whether the limit or your behaviour should change. The gap is not a guaranteed saving.',
    evidence: `${gbp(budget.observedMonthlySpending!)} observed monthly spending against a ${gbp(budget.monthlyLimit)} limit.`,
    href: '/transactions', actionLabel: 'Review spending', references: [PLANNING_REFERENCES.budget], amount: Math.abs(budget.remaining!),
  });
  const rising = plan.spending.categories.find((category) => category.monthlyChange != null && category.monthlyChange > 20 && (category.changePercent ?? 0) > 10 && category.personalTotal > 0);
  if (rising) push({
    id: 'spending-trend', priority: 'medium', topic: 'spending', title: `Understand the rise in ${rising.name}`,
    detail: 'Compare the transactions with the previous three months. Decide whether the increase is necessary, temporary or something you want to reduce.',
    evidence: `Observed monthly spending rose by ${gbp(rising.monthlyChange!)} (${rising.changePercent}%). This includes any tagged property spending shown in the category.`,
    href: '/transactions', actionLabel: 'Compare spending', references: [PLANNING_REFERENCES.budget], amount: rising.monthlyChange,
  });
  if (plan.recurring.length) push({
    id: 'review-recurring', priority: 'medium', topic: 'spending', title: 'Confirm your recurring payment candidates',
    detail: 'Confirm the service, whether you still use it and any cancellation terms. Repeated payments can be ordinary purchases or bills; the app does not assume they are cancellable subscriptions.',
    evidence: `${plan.recurring.length} merchants have a consistent monthly payment pattern in the imported history.`,
    href: '/transactions', actionLabel: 'Review payments', references: [PLANNING_REFERENCES.budget], amount: null,
  });
  if (profile.monthlySavingsTarget != null && plan.cashflow.monthlySurplus != null && plan.cashflow.monthlySurplus < profile.monthlySavingsTarget) push({
    id: 'savings-target', priority: 'medium', topic: 'spending', title: 'Align your savings target with cashflow',
    detail: 'Check account coverage and saving transfers, then adjust the target or identify affordable changes. Recorded cashflow is before saving/investing transfers and may not equal your actual savings.',
    evidence: `${gbp(plan.cashflow.monthlySurplus)} observed monthly surplus versus a ${gbp(profile.monthlySavingsTarget)} entered monthly target.`,
    href: '/plan', actionLabel: 'Review savings target', references: [PLANNING_REFERENCES.budget], amount: subtract(profile.monthlySavingsTarget, plan.cashflow.monthlySurplus),
  });
  if (profile.investmentHorizonYears == null || profile.riskTolerance == null) push({
    id: 'investment-profile', priority: 'medium', topic: 'investing', title: 'Define your investing horizon and risk tolerance',
    detail: 'Separate money you may need soon from long-term goals. Record your time horizon and comfort with losses, and review cash reserves and debts before deciding whether to invest.',
    evidence: 'A suitable investment mix cannot be inferred from balances or recent spending alone.',
    href: '/plan', actionLabel: 'Set investment preferences', references: [PLANNING_REFERENCES.investing], amount: null,
  });
  else push({
    id: 'review-investments', priority: 'low', topic: 'investing', title: 'Review investment diversification and fees',
    detail: 'Review what each fund actually holds, provider costs, overlap and the risk you can afford. A recorded horizon and risk preference are a starting point; holdings, goals and circumstances are still needed for an allocation recommendation.',
    evidence: `Entered investing horizon: ${profile.investmentHorizonYears} years; risk preference: ${profile.riskTolerance}. No security or portfolio allocation is recommended.`,
    href: '/investments', actionLabel: 'Review investments', references: [PLANNING_REFERENCES.diversification], amount: null,
  });
  if ((plan.balanceSheet.propertySharePercent ?? 0) >= 50) push({
    id: 'property-concentration', priority: 'medium', topic: 'property', title: 'Review how much of your wealth depends on property',
    detail: 'Consider tenant gaps, repairs, interest-rate changes and how quickly assets can be sold. Keep a property cash reserve and review diversification against your wider goals.',
    evidence: `Property is ${plan.balanceSheet.propertySharePercent}% of known gross asset values, before debt and selling costs${plan.balanceSheet.missingPropertyValuations ? '; some property valuations are missing' : ''}.`,
    href: '/properties', actionLabel: 'Review properties', references: [PLANNING_REFERENCES.landlord, PLANNING_REFERENCES.diversification], amount: null,
  });
  for (const property of plan.properties.filter((item) => item.monthlyOperatingSurplus != null && item.monthlyOperatingSurplus < 0).slice(0, 3)) push({
    id: `property-cashflow-${property.id}`, priority: 'high', topic: 'property', title: `Review the cash shortfall at ${property.name}`,
    detail: 'Verify rent received, operating costs and mortgage payments, then allow for voids, repairs, tax and refinancing risk. Entered monthly figures may omit irregular costs.',
    evidence: `${gbp(property.monthlyOperatingSurplus!)} monthly rent less entered costs. This is not a tax profit or a forecast.`,
    href: property.href, actionLabel: 'Review property', references: [PLANNING_REFERENCES.landlord], amount: Math.abs(property.monthlyOperatingSurplus!),
  });
  if (plan.balanceSheet.missingPropertyValuations > 0) push({
    id: 'property-valuations', priority: 'medium', topic: 'data', title: 'Update missing property valuations',
    detail: 'Record a current estimated market value and check outstanding mortgage balances. Net worth and property concentration currently include known values only.',
    evidence: `${plan.balanceSheet.missingPropertyValuations} properties have no recorded valuation.`,
    href: '/properties', actionLabel: 'Update properties', references: [], amount: null,
  });
  push({
    id: 'retirement-review', priority: 'low', topic: 'retirement', title: 'Build a complete pension picture',
    detail: 'Check workplace and personal pensions, employer contributions, charges and your State Pension forecast. Record your target retirement age and income before assessing a retirement gap.',
    evidence: plan.retirement.pensionValue == null ? 'No pension balance is recorded. This does not establish that you have no pension.' : `${gbp(plan.retirement.pensionValue)} of recorded pension assets. Pension balances are excluded from emergency cash.`,
    href: '/investments', actionLabel: 'Review pensions', references: [PLANNING_REFERENCES.pension, PLANNING_REFERENCES.pensionTracing], amount: null,
  });
  const rank = { high: 0, medium: 1, low: 2 };
  return actions.sort((a, b) => rank[a.priority] - rank[b.priority]);
}

/** Pure, deterministic decision support. It never calls AI or recommends securities. */
export function buildFinancialPlan(input: PlanningInput): FinancialPlan {
  validate(input);
  const suppliedProfile = input.profile ?? {};
  const scenario = suppliedProfile.retirementScenario;
  const profile: PlanningProfile = {
    ...suppliedProfile,
    currentAge: suppliedProfile.currentAge ?? scenario?.currentAge,
    retirementAge: suppliedProfile.retirementAge ?? scenario?.retirementAge,
    monthlyPensionContribution: suppliedProfile.monthlyPensionContribution ?? (scenario ? add([scenario.monthlyContribution, scenario.monthlyEmployerContribution]) : null),
    targetRetirementIncome: suppliedProfile.targetRetirementIncome ?? scenario?.desiredAnnualIncome,
    statePensionAnnual: suppliedProfile.statePensionAnnual ?? scenario?.expectedAnnualStatePension,
  };
  const cashAccessibility = input.cashAccessibility ?? 'confirmed';
  const isCashEstimate = cashAccessibility === 'inferred';
  const recentMonths = [-3, -2, -1].map((offset) => monthAt(input.asOf, offset));
  const previousMonths = [-6, -5, -4].map((offset) => monthAt(input.asOf, offset));
  const recentPeriod = period(recentMonths);
  const previousPeriod = period(previousMonths);
  const eligible = input.transactions.filter((transaction) => !transaction.isTransfer && transaction.date <= input.asOf);
  const recent = eligible.filter((transaction) => transaction.date >= recentPeriod.start && transaction.date <= recentPeriod.end);
  const previous = eligible.filter((transaction) => transaction.date >= previousPeriod.start && transaction.date <= previousPeriod.end);
  const recentMonthsWithData = recentMonths.filter((month) => recent.some((transaction) => transaction.date.startsWith(month))).length;
  const previousMonthsWithData = previousMonths.filter((month) => previous.some((transaction) => transaction.date.startsWith(month))).length;
  const recentRepresented = recentMonthsWithData === 3;
  const previousRepresented = previousMonthsWithData === 3;
  const recentTotals = totals(recent);
  const previousTotals = totals(previous);
  const monthlySpending = recentRepresented && recentTotals ? divide(recentTotals.spending, 3) : null;
  const previousMonthlySpending = previousRepresented && previousTotals ? divide(previousTotals.spending, 3) : null;
  const monthlySpendingChange = monthlySpending != null && previousMonthlySpending != null ? subtract(monthlySpending, previousMonthlySpending) : null;
  const sortedDates = eligible.map((transaction) => transaction.date).sort();
  const warnings = ['Recorded activity in a month does not confirm a complete statement or coverage of every account. All figures are based on imported records.'];
  if (!recentRepresented) warnings.push('Missing recent months are unknown, not zero. Monthly averages, trends and budget progress need all three recent months to be represented.');
  if (!previousRepresented) warnings.push('The previous three-month baseline is incomplete; change comparisons are unavailable.');
  if (recent.some((transaction) => transaction.cashflowType == null && transaction.amount > 0)) warnings.push('Unclassified positive transactions are treated as receipts. Label refunds explicitly to avoid overstating income.');

  const financialAccounts = input.accounts.filter((account) => account.accountType === 'ASSET' || account.accountType === 'LIABILITY');
  const assets = financialAccounts.filter((account) => account.accountType === 'ASSET');
  const isPension = (kind: string | null | undefined) => /pension|sipp/i.test(kind ?? '');
  const cashAccounts = assets.filter((account) => account.isLiquidCash === true && !isPension(account.investmentKind));
  const pensionAccounts = assets.filter((account) => isPension(account.investmentKind));
  const investmentAccounts = assets.filter((account) => account.isInvestment && !isPension(account.investmentKind) && !cashAccounts.includes(account));
  const cash = cashAccounts.length ? add(cashAccounts.map((account) => account.balance)) : null;
  const pensions = pensionAccounts.length ? add(pensionAccounts.map((account) => Math.max(0, account.balance))) : null;
  const investments = investmentAccounts.length ? add(investmentAccounts.map((account) => Math.max(0, account.balance))) : null;
  const valuedProperties = input.properties.filter((property) => property.value != null && property.value > 0);
  const propertyValue = valuedProperties.length ? add(valuedProperties.map((property) => property.value!)) : null;
  const propertyDebt = input.properties.length ? add(input.properties.map((property) => property.debt)) : null;
  const otherDebt = financialAccounts.length ? add([
    ...input.accounts.filter((account) => account.accountType === 'LIABILITY').map((account) => Math.max(0, -account.balance)),
    ...assets.filter((account) => account.balance < 0).map((account) => Math.abs(account.balance)),
  ]) : null;
  const hasBalanceData = financialAccounts.length > 0 || input.properties.length > 0;
  const totalDebt = hasBalanceData ? add([otherDebt ?? 0, propertyDebt ?? 0]) : null;
  const knownAssets = hasBalanceData ? add([
    ...assets.map((account) => Math.max(0, account.balance)),
    ...input.accounts.filter((account) => account.accountType === 'LIABILITY').map((account) => Math.max(0, account.balance)),
    propertyValue ?? 0,
  ]) : null;
  const netWorth = knownAssets != null && totalDebt != null ? subtract(knownAssets, totalDebt) : null;
  const targetMonths = profile.emergencyFundMonths ?? 3;
  const essentialMonthlySpending = profile.essentialMonthlySpending != null && profile.essentialMonthlySpending > 0 ? pounds(profile.essentialMonthlySpending) : null;
  const cashAvailable = cash != null ? Math.max(0, cash) : null;
  const targetAmount = essentialMonthlySpending != null ? pounds(new Money(essentialMonthlySpending).times(targetMonths)) : null;
  const coverageMonths = cashAvailable != null && essentialMonthlySpending != null ? divide(cashAvailable, essentialMonthlySpending) : null;
  const shortfall = targetAmount != null && cashAvailable != null ? Math.max(0, subtract(targetAmount, cashAvailable)) : null;
  const cashBasis = isCashEstimate
    ? 'Accessible cash is estimated from account-name and savings-tag classifications, not confirmed withdrawal access. Verify restrictions, earmarked money and account completeness; reserve status and shortfall are estimates.'
    : 'Cash accounts have been explicitly classified as accessible by the input provider.';
  const reserveBasis = essentialMonthlySpending == null
    ? 'Essential monthly outgoings are missing or zero; reserve coverage cannot be calculated.'
    : cashAvailable == null
      ? 'No account is classified as accessible cash; reserve coverage cannot be calculated.'
      : `Coverage uses ${isCashEstimate ? 'estimated' : 'explicitly classified'} accessible cash and entered essential monthly outgoings. ${profile.emergencyFundMonths == null ? 'The default three-month target is a starting point for your plan.' : 'The reserve target is your entered preference.'} Pensions and other investments are excluded.`;

  const properties: PropertyPlan[] = input.properties.map((property) => {
    const value = property.value != null && property.value > 0 ? pounds(property.value) : null;
    const observed = recent.filter((transaction) => transaction.propertyId === property.id);
    const observedTotals = totals(observed);
    const propertyWarnings = ['Monthly rent less entered costs is before any omitted voids, repairs, tax or selling costs; it is not a tax profit.'];
    if (value == null) propertyWarnings.push('No positive market valuation is recorded; equity, loan-to-value and yield are unknown.');
    if (property.monthlyRent == null || property.monthlyCosts == null) propertyWarnings.push('Monthly rent or costs are missing; operating surplus is unknown.');
    return {
      id: property.id, name: property.name, value, debt: pounds(property.debt),
      equity: value != null ? subtract(value, property.debt) : null,
      loanToValuePercent: value != null ? percent(property.debt, value) : null,
      monthlyRent: property.monthlyRent != null ? pounds(property.monthlyRent) : null,
      monthlyCosts: property.monthlyCosts != null ? pounds(property.monthlyCosts) : null,
      monthlyOperatingSurplus: property.monthlyRent != null && property.monthlyCosts != null ? subtract(property.monthlyRent, property.monthlyCosts) : null,
      grossYieldPercent: value != null && property.monthlyRent != null ? percent(pounds(new Money(property.monthlyRent).times(12)), value) : null,
      threeMonthCostReserve: property.monthlyCosts != null ? pounds(new Money(property.monthlyCosts).times(3)) : null,
      observedIncome: observedTotals?.income ?? null, observedSpending: observedTotals?.spending ?? null,
      warnings: propertyWarnings, href: `/properties/${property.id}`,
    };
  });
  const categories = comparison(recent, previous, 'category', recentRepresented, previousRepresented);
  const merchants = comparison(recent, previous, 'merchant', recentRepresented, previousRepresented);
  const budgets: BudgetProgress[] = input.budgets.map((budget) => {
    // Personal budgets exclude property cashflow, even where the same category is used.
    const matching = recent.filter((transaction) => !isIncome(transaction) && transaction.propertyId == null && (
      budget.categoryId != null
        ? transaction.categoryId === budget.categoryId || transaction.categoryAncestorIds?.includes(budget.categoryId)
        : transaction.category.trim().toLocaleLowerCase('en-GB') === budget.category.trim().toLocaleLowerCase('en-GB')
    ));
    const observedMonthlySpending = recentRepresented && matching.length ? divide(add(matching.map((transaction) => new Money(transaction.amount).negated())), 3) : null;
    const remaining = observedMonthlySpending != null ? subtract(budget.monthlyLimit, observedMonthlySpending) : null;
    return {
      category: budget.category, categoryId: budget.categoryId, monthlyLimit: pounds(budget.monthlyLimit), observedMonthlySpending, remaining,
      utilisationPercent: observedMonthlySpending != null ? percent(observedMonthlySpending, budget.monthlyLimit) : null,
      status: remaining == null ? 'unknown' : remaining < 0 ? 'over-budget' : 'within-budget',
    };
  });
  const retirementCurrentAge = scenario?.currentAge ?? suppliedProfile.currentAge ?? null;
  const retirementTargetAge = scenario?.retirementAge ?? suppliedProfile.retirementAge ?? null;
  const retirementMonthlyContribution = scenario ? add([scenario.monthlyContribution, scenario.monthlyEmployerContribution]) : suppliedProfile.monthlyPensionContribution ?? null;
  const yearsToRetirement = retirementCurrentAge != null && retirementTargetAge != null ? pounds(retirementTargetAge - retirementCurrentAge) : null;
  const plan: Omit<FinancialPlan, 'actions'> = {
    asOf: input.asOf, currency: 'GBP',
    coverage: {
      status: !recent.length ? 'empty' : recentRepresented ? 'represented' : 'limited',
      recentMonthsWithData, previousMonthsWithData,
      recentTransactionCount: recent.length, previousTransactionCount: previous.length,
      excludedTransfers: input.transactions.filter((transaction) => transaction.isTransfer && transaction.date <= input.asOf).length,
      ignoredFutureTransactions: input.transactions.filter((transaction) => transaction.date > input.asOf).length,
      firstTransactionDate: sortedDates[0] ?? null, lastTransactionDate: sortedDates.at(-1) ?? null,
      missingRecentMonths: recentMonths.filter((month) => !recent.some((transaction) => transaction.date.startsWith(month))), warnings,
    },
    cashflow: {
      recentPeriod, previousPeriod, recent: recentTotals, previous: previousTotals,
      monthlyIncome: recentRepresented && recentTotals ? divide(recentTotals.income, 3) : null,
      monthlySpending,
      monthlyPersonalSpending: recentRepresented && recentTotals ? divide(recentTotals.personalSpending, 3) : null,
      monthlyPropertySpending: recentRepresented && recentTotals ? divide(recentTotals.propertySpending, 3) : null,
      monthlySurplus: recentRepresented && recentTotals ? divide(recentTotals.net, 3) : null,
      savingsRate: recentRepresented && recentTotals ? percent(recentTotals.net, recentTotals.income) : null,
      monthlySpendingChange,
      monthlySpendingChangePercent: monthlySpendingChange != null && previousMonthlySpending != null ? percent(monthlySpendingChange, previousMonthlySpending) : null,
      months: [...previousMonths, ...recentMonths].map((month) => ({ month, totals: totals(eligible.filter((transaction) => transaction.date.startsWith(month))) })),
    },
    spending: { categories, merchants },
    recurring: recurringCandidates([...previous, ...recent], recentMonths),
    balanceSheet: {
      cash, investments, pensions, propertyValue, propertyDebt,
      propertyEquity: propertyValue != null && propertyDebt != null ? subtract(propertyValue, propertyDebt) : null,
      otherDebt, totalDebt, netWorth, knownAssets,
      propertySharePercent: propertyValue != null && knownAssets != null ? percent(propertyValue, knownAssets) : null,
      missingPropertyValuations: input.properties.length - valuedProperties.length,
      unclassifiedAssets: assets.filter((account) => !cashAccounts.includes(account) && !pensionAccounts.includes(account) && !investmentAccounts.includes(account)).length,
    },
    emergencyFund: {
      cashAccessibility, isEstimate: isCashEstimate,
      cashAvailable, essentialMonthlySpending, targetMonths, targetAmount, coverageMonths, shortfall,
      status: shortfall == null ? 'unknown' : shortfall > 0 ? 'below-target' : 'on-target',
      basis: `${cashBasis} ${reserveBasis}`,
    },
    properties, budgets,
    retirement: {
      pensionValue: pensions, scenarioPot: scenario?.currentPot ?? null,
      projectionScope: scenario ? 'personal-scenario' : 'unavailable',
      currentAge: retirementCurrentAge, retirementAge: retirementTargetAge,
      yearsToRetirement, monthlyContribution: retirementMonthlyContribution,
      targetAnnualIncome: scenario?.desiredAnnualIncome ?? suppliedProfile.targetRetirementIncome ?? null,
      statePensionAnnual: scenario?.expectedAnnualStatePension ?? suppliedProfile.statePensionAnnual ?? null,
      contributionsOnlyAtRetirement: scenario ? pounds(new Money(scenario.currentPot).plus(new Money(scenario.monthlyContribution).plus(scenario.monthlyEmployerContribution).times(12).times(scenario.retirementAge - scenario.currentAge))) : null,
      basis: 'Recorded pension value covers the household and may include multiple owners. The contribution-only illustration uses only the saved personal scenario’s user-entered pot, ages and gross personal plus employer contributions; it never uses the household pension total. The scenario pot is a user-entered snapshot, including any values copied from selected accounts, not a verified ongoing pension balance. Without a personal scenario pot, that illustration stays unknown. No growth, fees, inflation, tax or withdrawals are assumed; it is not an income forecast. State Pension entries are user-provided, not verified entitlements.',
    },
    methodology: [
      'Latest three completed calendar months are compared with the preceding three; the current month and future transactions are excluded from trends.',
      'Inter-account transfers are excluded. Explicitly classified refunds reduce the original spending category; unclassified receipts are income.',
      'Monthly averages require activity in every month. Represented months can still contain partial imports; missing observations are never proof of zero spending.',
      'Outgoings include supplied mortgage principal payments. Surplus is before saving and investing transfers and is not a measure of tax profit or confirmed savings.',
      'Savings rate is recorded net cashflow divided by income, not verified transfers into savings. Debt-service affordability cannot be inferred from outstanding debt balances without required payment and income details.',
      'Personal budgets exclude property-tagged spending. Recurring candidates require consistent merchant, amount and monthly dates and need your confirmation.',
      'Balance totals include known recorded assets and debts only. Property assets and mortgages must not also be supplied as accounts. Missing valuations reduce the completeness of net worth.',
      `Accessible cash ${isCashEstimate ? 'is estimated from inferred account classifications; withdrawal access and earmarked balances must be verified' : 'uses account classifications explicitly supplied by the input provider'}. Pension balances are always excluded; negative asset balances are treated as debt.`,
      'Guidance is a prioritised review checklist based on recorded facts and your inputs. Linked official resources are further reading; the app does not select securities or promise savings or investment returns.',
    ],
  };
  return { ...plan, actions: buildActions(plan, profile) };
}
