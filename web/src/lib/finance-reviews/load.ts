import { createHash, randomUUID } from 'node:crypto';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { loadPlanningInput, type PlanningDataSource } from '@/lib/planning/load';
import { buildFinancialPlan } from '@/lib/planning/engine';
import type { FinancialPlan, PlanningAction, PlanningProfile } from '@/lib/planning/types';
import { cashExclusionReason, loadFinancialContext, type ContextWorkspace } from '@/lib/finance-context';
import { loadContextLookup } from '@/lib/finance-context/lookup';
import { loadDebtWorkspace } from '@/lib/debts/load';
import { loadPortfolioWorkspace } from '@/lib/portfolio/load';
import { loadPensionRecordsWorkspace } from '@/lib/pension-records/load';
import { loadPropertyOperationsWorkspace } from '@/lib/property-operations/load';
import { savingsGoalRepo } from '@/lib/repos/savings-goal.repo';
import { readWorkspace, writeWorkspace, WorkspaceConflictError, type WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import { actionReviewState, compareReviews } from './engine';
import { goalsProgressSchema, initialReviews, REVIEWS_KEY, reviewEditableSchema, reviewsDataSchema, reviewSnapshotSchema, type GoalsProgress, type ReviewsData, type ReviewSnapshot } from './schema';

export type FeatureAvailability<T> = { status: 'ready'; data: T } | { status: 'unavailable'; error: string };
export interface ReviewFeatures {
  debts: FeatureAvailability<Awaited<ReturnType<typeof loadDebtWorkspace>>>;
  portfolio: FeatureAvailability<Awaited<ReturnType<typeof loadPortfolioWorkspace>>>;
  pensions: FeatureAvailability<Awaited<ReturnType<typeof loadPensionRecordsWorkspace>>>;
  property: FeatureAvailability<Awaited<ReturnType<typeof loadPropertyOperationsWorkspace>>>;
  goals: FeatureAvailability<GoalsProgress>;
}
export type ActionSource = 'plan' | 'context' | keyof ReviewFeatures;
export interface ReviewQueueEntry {
  action: PlanningAction;
  evidenceFingerprint: string;
  source: ActionSource;
  state: ReturnType<typeof actionReviewState>;
}
export interface ReviewsOverview {
  workspace: WorkspaceEnvelope<ReviewsData>;
  plan: FinancialPlan;
  source: PlanningDataSource;
  context: ContextWorkspace;
  features: ReviewFeatures;
  actionQueue: ReviewQueueEntry[];
  comparison: ReturnType<typeof compareReviews>;
  recurringCandidates: FinancialPlan['recurring'];
  warnings: string[];
}

export class FinanceReviewUnavailableError extends Error {
  constructor() {
    super('Your household plan or personal context could not be loaded. No financial review has been saved. Check the connection and retry.');
    this.name = 'FinanceReviewUnavailableError';
  }
}

async function optionalFeature<T>(load: () => Promise<T>): Promise<FeatureAvailability<T>> {
  try { return { status: 'ready', data: await load() }; }
  catch { return { status: 'unavailable', error: 'This planning workspace could not be read. Its amounts and actions remain unknown; retry when it is available.' }; }
}

export async function loadGoalsProgress(): Promise<GoalsProgress> {
  const goals = await savingsGoalRepo.getAll();
  return goalsProgressSchema.parse({
    basis: 'manual_progress',
    goals: goals.map(goal => {
      const target = new Decimal(goal.targetAmount);
      const current = new Decimal(goal.currentAmount);
      return {
        id: goal.id, name: goal.name, targetAmount: target.toFixed(2), currentAmount: current.toFixed(2),
        targetDate: goal.targetDate, accountId: goal.accountId, status: goal.status,
        progressPercent: target.gt(0) ? current.div(target).times(100).toDecimalPlaces(2).toNumber() : null,
      };
    }).sort((a, b) => a.id - b.id),
  });
}

/** Sorted object keys keep hashes independent of serialization/key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

export function evidenceFingerprint(source: ActionSource, id: string, facts: unknown): string {
  return createHash('sha256').update(canonical({ version: 1, scope: 'household', source, id, facts })).digest('hex');
}

function planActionFacts(action: PlanningAction, plan: FinancialPlan, profile: PlanningProfile) {
  switch (action.id) {
    case 'complete-history': return { period: plan.cashflow.recentPeriod, represented: plan.coverage.recentMonthsWithData, missing: plan.coverage.missingRecentMonths };
    case 'review-debt': return { total: plan.balanceSheet.totalDebt, property: plan.balanceSheet.propertyDebt, other: plan.balanceSheet.otherDebt };
    case 'emergency-inputs':
    case 'emergency-shortfall': return plan.emergencyFund;
    case 'cashflow-deficit': return { period: plan.cashflow.recentPeriod, income: plan.cashflow.monthlyIncome, spending: plan.cashflow.monthlySpending, surplus: plan.cashflow.monthlySurplus };
    case 'spending-trend': {
      // Names can be shared by different ledger categories. Match the engine's
      // actual rising category, then fingerprint its stable ID as well as name.
      const category = plan.spending.categories.find(item => item.monthlyChange !== null && item.monthlyChange > 20 && (item.changePercent ?? 0) > 10 && item.personalTotal > 0);
      return { period: plan.cashflow.recentPeriod, previousPeriod: plan.cashflow.previousPeriod, category: category ? { id: category.categoryId ?? null, name: category.name, recent: category.monthlyAverage, previous: category.previousMonthlyAverage, change: category.monthlyChange, changePercent: category.changePercent } : { title: action.title, evidence: action.evidence } };
    }
    case 'review-recurring': return plan.recurring.map(item => ({ merchant: item.merchant, amount: item.typicalPayment, count: item.paymentCount, dates: item.dates, range: item.amountRange })).sort((a, b) => a.merchant.localeCompare(b.merchant));
    case 'savings-target': return { period: plan.cashflow.recentPeriod, surplus: plan.cashflow.monthlySurplus, target: profile.monthlySavingsTarget ?? null };
    case 'investment-profile':
    case 'review-investments': return { horizon: profile.investmentHorizonYears ?? null, risk: profile.riskTolerance ?? null };
    case 'property-concentration': return { share: plan.balanceSheet.propertySharePercent, value: plan.balanceSheet.propertyValue, knownAssets: plan.balanceSheet.knownAssets, missingValues: plan.balanceSheet.missingPropertyValuations };
    case 'property-valuations': return plan.properties.filter(property => property.value === null).map(property => property.id).sort((a, b) => a - b);
    case 'retirement-review': return plan.retirement;
    default:
      if (action.id.startsWith('property-cashflow-')) return plan.properties.find(property => action.id === `property-cashflow-${property.id}`) ?? { evidence: action.evidence, amount: action.amount };
      if (action.id.startsWith('budget-')) return { period: plan.cashflow.recentPeriod, budget: plan.budgets.find(budget => action.id === `budget-${budget.categoryId ?? budget.category}`) };
      return { period: plan.cashflow.recentPeriod, previousPeriod: plan.cashflow.previousPeriod, evidence: action.evidence, amount: action.amount };
  }
}

type QueueInput = Pick<ReviewsOverview, 'workspace' | 'plan' | 'context' | 'features'> & { profile?: PlanningProfile | null };

/** Explained, deterministic prompts to review facts; never instructions to buy or sell. */
export function buildReviewActionQueue(input: QueueInput): ReviewQueueEntry[] {
  const { workspace, plan, context, features } = input;
  const entries: ReviewQueueEntry[] = [];
  const add = (source: ActionSource, action: PlanningAction, facts: unknown) => {
    const id = action.id.length <= 180 ? action.id : `action-${createHash('sha256').update(action.id).digest('hex')}`;
    const fingerprint = evidenceFingerprint(source, id, facts);
    entries.push({ source, action: { ...action, id }, evidenceFingerprint: fingerprint, state: actionReviewState({ id, evidenceFingerprint: fingerprint }, workspace.data.actions, plan.asOf) });
  };
  const extra = (source: ActionSource, id: string, topic: PlanningAction['topic'], priority: PlanningAction['priority'], title: string, detail: string, evidence: string, href: string, facts: unknown) => {
    add(source, { id, topic, priority, title, detail, evidence, href, actionLabel: 'Review details', references: [], amount: null }, facts);
  };
  for (const action of plan.actions) {
    const routed = action.id === 'review-debt' ? { ...action, href: '/debts', actionLabel: 'Review debts', detail: 'Check lender statements, interest rates, required payments, priority bills and any arrears before comparing repayments. Mortgage debt alone does not establish that it should be overpaid.' }
      : action.id === 'retirement-review' ? { ...action, href: '/pensions/records', actionLabel: 'Review pension records' }
      : action.id === 'review-recurring' ? { ...action, href: '/review', actionLabel: 'Confirm payments' } : action;
    add('plan', routed, planActionFacts(action, plan, input.profile ?? {}));
  }
  const missingContext = (['ownerId', 'taxResidence', 'dependants', 'employmentStability'] as const).filter(key => context.data[key] === null);
  const contextLabels = { ownerId: 'your ledger owner', taxResidence: 'UK tax residence', dependants: 'number of dependants', employmentStability: 'employment income stability' };
  if (missingContext.length) extra('context', 'context-personal-details', 'data', 'medium', 'Complete your personal planning context', 'Record ownership, location and household circumstances before interpreting personal pension or tax questions. The figures on this review remain household totals.', `Unknown details: ${missingContext.map(key => contextLabels[key]).join(', ')}.`, '/profile', { missingContext });
  const unconfirmedCash = context.lookup.accounts.filter(account => cashExclusionReason(account) === null && !context.data.accountAccessibility.some(item => item.accountId === account.id)).map(account => account.id).sort((a, b) => a - b);
  if (unconfirmedCash.length) extra('context', 'context-cash-accessibility', 'emergency', 'high', 'Confirm which accounts can fund your cash reserve', 'Check withdrawal restrictions and earmarked balances. Exclude assets that cannot be used for unexpected bills before relying on a reserve amount.', `${unconfirmedCash.length} potentially eligible account(s) have no saved accessibility confirmation.`, '/profile', { accountIds: unconfirmedCash });
  if (context.data.nextReviewDate !== null && context.data.nextReviewDate <= plan.asOf) extra('context', 'context-review-due', 'data', 'medium', 'Your next financial review is due', 'Review changes in spending, borrowing and household circumstances, then set the next date.', `Your saved review date is ${context.data.nextReviewDate}.`, '/profile', { reviewDate: context.data.nextReviewDate, due: true });

  const featureRoutes = { debts: '/debts', portfolio: '/portfolio', pensions: '/pensions/records', property: '/properties/operations', goals: '/goals' };
  for (const [source, feature] of Object.entries(features) as [keyof ReviewFeatures, ReviewFeatures[keyof ReviewFeatures]][]) {
    if (feature.status === 'unavailable') extra(source, `workspace-${source}-unavailable`, 'data', 'high', `Restore your ${source} planning data`, 'Retry the workspace before using its figures. Missing data has not been replaced with empty records or zero amounts.', feature.error, featureRoutes[source], { unavailable: true });
  }
  if (features.debts.status === 'ready') {
    const { debts, accounts } = features.debts.data;
    const missingLinks = accounts.filter(account => new Decimal(account.balance).lt(0) && !debts.some(debt => debt.accountId === account.id)).map(account => account.id).sort((a, b) => a - b);
    if (missingLinks.length) extra('debts', 'debt-unrecorded-terms', 'debt', 'high', 'Record terms for your ledger liabilities', 'Link recorded borrowing to lender terms so required payments and interest can be assessed. The ledger debt is already included in household balances.', `${missingLinks.length} liability account(s) with amounts owed have no linked debt terms.`, '/debts', { accountIds: missingLinks });
    for (const debt of debts) {
      const facts = { accountId: debt.accountId, ownerId: debt.ownerId, balance: debt.effectiveBalance, balanceSource: debt.balanceSource, statementAsOf: debt.accountId === null ? debt.statementAsOf : null, apr: debt.apr, minimum: debt.minimumPayment, priority: debt.priority, arrears: debt.inArrears, promotionalApr: debt.promotionalApr, promotionalExpiresOn: debt.promotionalExpiresOn };
      if (debt.inArrears || debt.priority) extra('debts', `debt-priority-${debt.id}`, 'debt', 'high', `Review priority commitments for ${debt.name}`, 'Confirm required payments and arrears with the lender. If payments are unaffordable, use free debt help before pursuing optional repayments or investing.', `Priority flag: ${debt.priority ? 'yes' : 'no'}; arrears flag: ${debt.inArrears ? 'yes' : 'no'}. These are your recorded flags.`, '/debts', facts);
      if (debt.effectiveBalance === null || debt.apr === null || debt.minimumPayment === null) extra('debts', `debt-terms-${debt.id}`, 'debt', 'medium', `Complete lender facts for ${debt.name}`, 'Record the balance, interest rate and required monthly payment from the lender. Unknown borrowing costs cannot be treated as zero.', `Balance ${debt.effectiveBalance === null ? 'unknown' : 'recorded'}; APR ${debt.apr === null ? 'unknown' : 'recorded'}; minimum payment ${debt.minimumPayment === null ? 'unknown' : 'recorded'}.`, '/debts', facts);
      if (debt.promotionalExpiresOn !== null) {
        const days = Math.round((Date.parse(`${debt.promotionalExpiresOn}T00:00:00Z`) - Date.parse(`${plan.asOf}T00:00:00Z`)) / 86400000);
        if (days <= 30) extra('debts', `debt-promotion-${debt.id}`, 'debt', 'high', `Check the promotional rate on ${debt.name}`, 'Check expiry terms, the follow-on rate and any fees or restrictions with the lender before choosing a repayment change.', `Saved promotional expiry: ${debt.promotionalExpiresOn}; ${days < 0 ? 'already passed' : 'within 30 days'}.`, '/debts', { ...facts, expiryState: days < 0 ? 'expired' : 'due_soon' });
      }
    }
  }
  if (features.portfolio.status === 'ready') {
    const { analysis } = features.portfolio.data;
    if (new Decimal(analysis.totalUnclassified).gt(0)) extra('portfolio', 'portfolio-classification', 'investing', 'medium', 'Complete the picture of your investment holdings', 'Record statement holdings inside their existing investment accounts. Holdings describe those balances and add nothing to household net worth.', `£${analysis.totalUnclassified} of recorded investment account value is unclassified.`, '/portfolio', { unclassified: analysis.totalUnclassified, accounts: analysis.accounts.map(account => ({ id: account.id, unclassified: account.unclassified })).sort((a, b) => a.id - b.id) });
    if (analysis.hasInconsistencies) extra('portfolio', 'portfolio-reconciliation', 'data', 'high', 'Reconcile holdings with investment account balances', 'Resolve over-allocation, missing links and negative balances against statements before relying on allocation or fee percentages.', `Recorded over-allocation: £${analysis.totalOverallocated}; orphan holdings: ${analysis.orphanHoldings.length}; orphan platform records: ${analysis.orphanPlatforms.length}.`, '/portfolio', { accounts: analysis.accounts.map(account => ({ id: account.id, overallocated: account.overallocated, negative: new Decimal(account.balance).lt(0) })).sort((a, b) => a.id - b.id), orphanHoldingIds: analysis.orphanHoldings.map(item => item.id).sort(), orphanPlatformIds: analysis.orphanPlatforms.map(item => item.accountId).sort((a, b) => a - b) });
    if (analysis.accounts.length && !analysis.fees.complete) extra('portfolio', 'portfolio-fees', 'investing', 'medium', 'Check unknown investment charges', 'Record fund and platform charges separately. The displayed annual known charges exclude unknown fees and other costs; they are not a complete cost estimate.', `£${analysis.fees.holdingFeeUnknownValue} of holdings have unknown stated fees; ${analysis.fees.platformFeeKnownAccountCount} of ${analysis.fees.accountCount} accounts have a recorded platform rate.`, '/portfolio', { fees: analysis.fees, unclassified: analysis.totalUnclassified, overallocated: analysis.totalOverallocated });
    const stale = analysis.accounts.filter(account => account.staleHoldingCount > 0).map(account => ({ id: account.id, staleCount: account.staleHoldingCount, oldestDate: account.oldestValuationDate })).sort((a, b) => a.id - b.id);
    if (stale.length) extra('portfolio', 'portfolio-statement-dates', 'investing', 'low', 'Refresh older holding snapshots', 'Check the latest statement or provider valuation. Recorded prices are not live market values, and matching totals alone does not verify a current valuation.', `${stale.length} account(s) contain holdings dated more than 30 days ago.`, '/portfolio', stale);
  }
  if (features.pensions.status === 'ready') {
    const { workspace: pensionWorkspace, pensionAccounts, summary } = features.pensions.data;
    const linked = new Set(pensionWorkspace.data.flatMap(record => record.type === 'dc' && record.linkedAccountId !== null ? [record.linkedAccountId] : []));
    const unlinked = pensionAccounts.filter(account => !linked.has(account.id)).map(account => account.id).sort((a, b) => a - b);
    if (unlinked.length) extra('pensions', 'pension-ledger-links', 'retirement', 'medium', 'Link your recorded pension accounts to schemes', 'Record DC contributions and charges against each existing pension account. Do not re-enter the same pot as a separate statement asset.', `${unlinked.length} ledger pension account(s) have no linked DC scheme record.`, '/pensions/records', { accountIds: unlinked });
    if (summary.unknownOwnershipCount) extra('pensions', 'pension-ownership', 'retirement', 'high', 'Assign pension ownership before using personal totals', 'Household pension figures can include several people. Check scheme ownership and use your own saved pot and contributions for a personal retirement illustration.', `${summary.unknownOwnershipCount} scheme(s) have unknown ownership.`, '/pensions/records', { recordIds: pensionWorkspace.data.filter(record => record.type === 'dc' && record.linkedAccountId !== null ? pensionAccounts.find(account => account.id === record.linkedAccountId)?.ownerId == null : record.ownerId === null).map(record => record.id).sort() });
    const missingDc = pensionWorkspace.data.filter(record => record.type === 'dc' && (record.personalMonthlyContribution === null || record.employerMonthlyContribution === null || record.annualFeeRate === null)).map(record => ({ id: record.id, personal: record.type === 'dc' ? record.personalMonthlyContribution : null, employer: record.type === 'dc' ? record.employerMonthlyContribution : null, fee: record.type === 'dc' ? record.annualFeeRate : null })).sort((a, b) => a.id.localeCompare(b.id));
    if (missingDc.length) extra('pensions', 'pension-contributions-fees', 'retirement', 'medium', 'Complete pension contributions and charges', 'Check statements for gross contributions credited to each DC pot and its charges. A missing employer contribution or fee is unknown, not zero.', `${missingDc.length} DC scheme(s) have an unknown contribution component or annual charge.`, '/pensions/records', missingDc);
    const ownerId = context.data.ownerId;
    const forecast = pensionWorkspace.data.find(record => record.type === 'state' && ownerId !== null && record.ownerId === ownerId);
    if (ownerId !== null && (!forecast || forecast.type !== 'state' || forecast.forecastAnnualIncome === null || forecast.forecastSourceDate === null)) extra('pensions', 'pension-state-forecast', 'retirement', 'medium', 'Record your official State Pension forecast', 'Use the official forecast and record its source date and conditions. No standard annual entitlement or start age is assumed from your age or household pension balance.', 'Your selected person has no complete dated State Pension forecast recorded.', '/pensions/records', { ownerId, forecast: forecast && forecast.type === 'state' ? { id: forecast.id, amount: forecast.forecastAnnualIncome, sourceDate: forecast.forecastSourceDate } : null });
    if (summary.warnings.length) extra('pensions', 'pension-source-checks', 'retirement', 'medium', 'Check pension record sources and links', 'Review undated statements, forecast conditions and any unavailable account links before copying figures into a retirement scenario.', summary.warnings.join(' '), '/pensions/records', { warnings: summary.warnings });
  }
  if (features.property.status === 'ready') {
    const { summary } = features.property.data;
    for (const obligation of summary.obligations.filter(item => item.status === 'open' && (item.isOverdue || item.isDueSoon))) extra('property', `property-obligation-${obligation.id}`, 'property', obligation.isOverdue ? 'high' : 'medium', `${obligation.isOverdue ? 'Review overdue' : 'Plan for'} ${obligation.title}`, 'Check your recorded due date and complete the underlying task. The app has not verified legal requirements or certified compliance.', `${obligation.propertyName}: saved due date ${obligation.dueDate}; ${obligation.isOverdue ? 'overdue' : 'within the next 30 days'}.`, '/properties/operations', { id: obligation.id, propertyId: obligation.propertyId, title: obligation.title, category: obligation.category, dueDate: obligation.dueDate, overdue: obligation.isOverdue, dueSoon: obligation.isDueSoon });
    for (const property of summary.properties) {
      if (property.unreconciledRentGap !== null && new Decimal(property.unreconciledRentGap).gt(0)) extra('property', `property-rent-reconciliation-${property.id}`, 'property', 'medium', `Reconcile scheduled rent at ${property.name}`, 'Compare the tenancy schedule with statements and property journal entries. Timing, refunds, other income and incomplete imports can change this gap; it does not establish tenant arrears.', `£${property.unreconciledRentGap} scheduled rent less recorded property income for ${summary.comparison.month}; coverage is unverified.`, '/properties/operations', { period: summary.comparison, scheduled: property.scheduledRent, income: property.recordedIncome, coverage: property.coverage });
      if (property.reserveTarget === null) extra('property', `property-reserve-${property.id}`, 'property', 'low', `Set a cash reserve assumption for ${property.name}`, 'Allow for voids, repairs and required commitments using your own assumptions. A reserve target is a plan, and does not allocate or add cash.', 'No property operating reserve target is recorded.', '/properties/operations', { propertyId: property.id, reserveTarget: null });
    }
  }
  if (features.goals.status === 'ready') {
    for (const goal of features.goals.data.goals.filter(goal => goal.status === 'active' && goal.targetDate !== null && goal.targetDate <= plan.asOf && new Decimal(goal.currentAmount).lt(goal.targetAmount))) extra('goals', `goal-deadline-${goal.id}`, 'spending', 'medium', `Review the target date for ${goal.name}`, 'Update manually recorded progress and check whether the goal amount and timing still fit your budget. This progress is not verified against account balances or added to net worth.', `Saved target date ${goal.targetDate}; manual progress £${goal.currentAmount} of £${goal.targetAmount}.`, '/goals', { id: goal.id, target: goal.targetAmount, progress: goal.currentAmount, targetDate: goal.targetDate, due: true });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return entries.sort((a, b) => rank[a.action.priority] - rank[b.action.priority] || a.action.id.localeCompare(b.action.id));
}

const money = (value: number | null): string | null => value === null ? null : new Decimal(value).toFixed(2);

export function createReviewSnapshot(overview: Pick<ReviewsOverview, 'plan' | 'source' | 'context' | 'features' | 'warnings'>, now = new Date()): ReviewSnapshot {
  const { plan, source, context, features } = overview;
  const workspaceRevisions: Record<string, number> = { context: context.revision };
  for (const key of ['debts', 'portfolio', 'pensions', 'property'] as const) {
    const feature = features[key];
    if (feature.status === 'ready') workspaceRevisions[key] = 'workspace' in feature.data ? feature.data.workspace.revision : feature.data.revision;
  }
  return reviewSnapshotSchema.parse({
    id: randomUUID(), recordedAt: now.toISOString(), asOf: plan.asOf, scope: 'household', currency: 'GBP',
    selectedOwnerId: source.selectedOwnerId,
    period: { start: plan.cashflow.recentPeriod.start, end: plan.cashflow.recentPeriod.end, monthsRecorded: plan.coverage.recentMonthsWithData },
    metrics: { monthlyIncome: money(plan.cashflow.monthlyIncome), monthlySpending: money(plan.cashflow.monthlySpending), monthlySurplus: money(plan.cashflow.monthlySurplus), netWorth: money(plan.balanceSheet.netWorth), cashReserve: money(plan.emergencyFund.cashAvailable), reserveShortfall: money(plan.emergencyFund.shortfall), debt: money(plan.balanceSheet.totalDebt) },
    workspaceRevisions, warnings: overview.warnings.slice(0, 100), goals: features.goals,
  });
}

/** Essential failures abort the review; optional failures remain visible. */
export async function loadFinanceReviewWorkspace(now = new Date()): Promise<ReviewsOverview> {
  let loaded: Awaited<ReturnType<typeof loadPlanningInput>>;
  let context: ContextWorkspace;
  try {
    const [planning, savedContext, lookup] = await Promise.all([loadPlanningInput(now), loadFinancialContext(), loadContextLookup(now)]);
    loaded = planning;
    context = { ...savedContext, lookup };
    // The planning loader reads context independently. Do not attach one
    // person's identity to a plan loaded using another person's selection.
    if (planning.source.selectedOwnerId !== savedContext.data.ownerId) throw new FinanceReviewUnavailableError();
  } catch { throw new FinanceReviewUnavailableError(); }
  let plan: FinancialPlan;
  try { plan = buildFinancialPlan(loaded.input); } catch { throw new FinanceReviewUnavailableError(); }
  const [workspace, debts, portfolio, pensions, property, goals] = await Promise.all([
    readWorkspace(REVIEWS_KEY, reviewsDataSchema, initialReviews),
    optionalFeature(loadDebtWorkspace), optionalFeature(loadPortfolioWorkspace), optionalFeature(loadPensionRecordsWorkspace),
    optionalFeature(() => loadPropertyOperationsWorkspace(now)), optionalFeature(loadGoalsProgress),
  ]);
  const features: ReviewFeatures = { debts, portfolio, pensions, property, goals };
  const warnings = Array.from(new Set([
    ...loaded.source.warnings, ...plan.coverage.warnings,
    'Review figures describe the whole recorded household. Selecting a person changes personal context, not the household ledger scope.',
    'Savings goal progress is manually maintained and is not an additional asset or a verified bank balance.',
    'Planning sections are read independently. Saved workspace revisions are captured when available; this review is not an atomic ledger snapshot or a complete backup.',
    ...Object.entries(features).filter(([, feature]) => feature.status === 'unavailable').map(([key]) => `${key} planning data is unavailable; no zero amount or empty record has been substituted.`),
  ]));
  const overview: ReviewsOverview = { workspace, plan, source: loaded.source, context, features, actionQueue: [], comparison: null, recurringCandidates: plan.recurring, warnings };
  overview.actionQueue = buildReviewActionQueue({ ...overview, profile: loaded.input.profile });
  overview.comparison = compareReviews(createReviewSnapshot(overview, now), workspace.data.snapshots.at(-1) ?? null);
  return overview;
}

/** Reject invented records and stale decisions, while preserving unchanged history. */
export function validateReviewEdits(data: z.infer<typeof reviewEditableSchema>, overview: ReviewsOverview): void {
  const current = new Map(overview.actionQueue.map(entry => [entry.action.id, entry]));
  const old = new Map(overview.workspace.data.actions.map(record => [record.id, record]));
  const issues: z.core.$ZodIssue[] = [];
  data.actions.forEach((record, index) => {
    const saved = old.get(record.id);
    // Historical decisions can travel unchanged through a full-editor save.
    if (saved && canonical(saved) === canonical(record)) return;
    const fresh = current.get(record.id);
    if (!fresh) { issues.push({ code: 'custom', path: ['actions', index, 'id'], message: 'Record only an action in the current review; unchanged historical records may be retained' }); return; }
    if (record.evidenceFingerprint !== fresh.evidenceFingerprint) throw new WorkspaceConflictError();
  });
  const merchants = new Set(overview.recurringCandidates.map(candidate => candidate.merchant.toLowerCase()));
  const savedMerchants = new Map(overview.workspace.data.recurring.map(record => [record.merchant.toLowerCase(), record]));
  data.recurring.forEach((record, index) => {
    const saved = savedMerchants.get(record.merchant.toLowerCase());
    // These are manually recorded decisions/intent, not certifications of
    // realised savings. A cancelled payment can disappear from current history
    // while its saved review remains editable. New merchants must be observed.
    if (saved) return;
    if (!merchants.has(record.merchant.toLowerCase())) issues.push({ code: 'custom', path: ['recurring', index, 'merchant'], message: 'Add a merchant detected in the current history, or update a previously saved merchant review' });
  });
  if (issues.length) throw new z.ZodError(issues);
}

export async function saveFinanceReviewWorkspace(data: unknown, expectedRevision: number): Promise<WorkspaceEnvelope<ReviewsData>> {
  const editable = reviewEditableSchema.parse(data);
  const overview = await loadFinanceReviewWorkspace();
  if (overview.workspace.revision !== expectedRevision) throw new WorkspaceConflictError();
  validateReviewEdits(editable, overview);
  // An editor may only send actions currently displayed. Preserve historical
  // decisions and notes that no longer appear in today's generated queue.
  const actionIds = new Set(editable.actions.map(record => record.id));
  const merchantIds = new Set(editable.recurring.map(record => record.merchant.toLowerCase()));
  return writeWorkspace(REVIEWS_KEY, reviewsDataSchema, {
    actions: [...overview.workspace.data.actions.filter(record => !actionIds.has(record.id)), ...editable.actions],
    recurring: [...overview.workspace.data.recurring.filter(record => !merchantIds.has(record.merchant.toLowerCase())), ...editable.recurring],
    snapshots: overview.workspace.data.snapshots,
  }, expectedRevision);
}

/** Capture only fresh server-derived household facts, never arbitrary client metrics. */
export async function captureFinanceReview(expectedRevision: number, now = new Date()): Promise<WorkspaceEnvelope<ReviewsData>> {
  const overview = await loadFinanceReviewWorkspace(now);
  if (overview.workspace.revision !== expectedRevision) throw new WorkspaceConflictError();
  const snapshot = createReviewSnapshot(overview, now);
  return writeWorkspace(REVIEWS_KEY, reviewsDataSchema, { ...overview.workspace.data, snapshots: [...overview.workspace.data.snapshots, snapshot].slice(-60) }, expectedRevision);
}
