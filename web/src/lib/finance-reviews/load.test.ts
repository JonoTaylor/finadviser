import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  planning: vi.fn(), context: vi.fn(), lookup: vi.fn(), read: vi.fn(), write: vi.fn(),
  debts: vi.fn(), portfolio: vi.fn(), pensions: vi.fn(), property: vi.fn(), goals: vi.fn(),
}));
vi.mock('@/lib/planning/load', () => ({ loadPlanningInput: mocks.planning }));
vi.mock('@/lib/finance-context', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/finance-context')>(), loadFinancialContext: mocks.context }));
vi.mock('@/lib/finance-context/lookup', () => ({ loadContextLookup: mocks.lookup }));
vi.mock('@/lib/debts/load', () => ({ loadDebtWorkspace: mocks.debts }));
vi.mock('@/lib/portfolio/load', () => ({ loadPortfolioWorkspace: mocks.portfolio }));
vi.mock('@/lib/pension-records/load', () => ({ loadPensionRecordsWorkspace: mocks.pensions }));
vi.mock('@/lib/property-operations/load', () => ({ loadPropertyOperationsWorkspace: mocks.property }));
vi.mock('@/lib/repos/savings-goal.repo', () => ({ savingsGoalRepo: { getAll: mocks.goals } }));
vi.mock('@/lib/finance-workspace/store', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/finance-workspace/store')>(), readWorkspace: mocks.read, writeWorkspace: mocks.write }));

import { buildFinancialPlan } from '@/lib/planning/engine';
import type { PlanningInput } from '@/lib/planning/types';
import { contextSchema, type ContextWorkspace } from '@/lib/finance-context/schema';
import { analyzePortfolio } from '@/lib/portfolio/analyze';
import { summarizePensionRecords } from '@/lib/pension-records/summary';
import { analyzePropertyOperations } from '@/lib/property-operations/engine';
import { WorkspaceConflictError, type WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import { buildReviewActionQueue, captureFinanceReview, createReviewSnapshot, evidenceFingerprint, FinanceReviewUnavailableError, loadFinanceReviewWorkspace, saveFinanceReviewWorkspace, validateReviewEdits, type ReviewFeatures, type ReviewsOverview } from './load';
import { initialReviews, reviewSnapshotSchema, type ActionRecord } from './schema';

const now = new Date('2026-10-11T12:00:00.000Z');
const envelope = <T>(data: T, revision = 0): WorkspaceEnvelope<T> => ({ version: 1, revision, updatedAt: revision ? now.toISOString() : null, data: structuredClone(data) });
const input = (): PlanningInput => ({
  asOf: '2026-10-11', cashAccessibility: 'confirmed',
  transactions: ['2026-07-01', '2026-08-01', '2026-09-01'].flatMap((date, index) => [
    { id: `income-${index}`, date, category: 'Salary', description: 'Salary', amount: 3000, cashflowType: 'income' as const },
    { id: `expense-${index}`, date, category: 'Food', description: 'Groceries', amount: -1500, cashflowType: 'expense' as const },
  ]),
  accounts: [{ id: 1, name: 'Bank', balance: 1000, accountType: 'ASSET', isLiquidCash: true, ownerId: 2 }, { id: 2, name: 'Pension', balance: 50000, accountType: 'ASSET', isInvestment: true, investmentKind: 'pension', ownerId: 2 }, { id: 3, name: 'Card', balance: -100, accountType: 'LIABILITY', ownerId: 2 }],
  properties: [{ id: 1, name: 'Flat', value: 200000, debt: 100000, monthlyRent: null, monthlyCosts: null }],
  budgets: [], profile: { essentialMonthlySpending: 1000, emergencyFundMonths: 3, investmentHorizonYears: 10, riskTolerance: 'medium' },
});
const context = (): ContextWorkspace => ({
  ...envelope(contextSchema.parse({ preferredName: 'Jono', ownerId: 2, taxResidence: 'england', dependants: 0, employmentStability: 'stable', accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }), 1),
  lookup: { asOf: '2026-10-11', owners: [{ id: 2, name: 'Jono' }], accounts: [{ id: 1, name: 'Bank', accountType: 'ASSET', isInvestment: false, investmentKind: null, ownerId: 2, balance: '1000.00', latestJournalDate: '2026-09-30', postingCount: 3, futurePostingCount: 0 }] },
});
const property = () => ({
  ...envelope({ obligations: [], reserveTargets: [{ propertyId: 1, targetAmount: '1000.00' }] }),
  summary: analyzePropertyOperations({ asOf: '2026-10-11', properties: [{ id: 1, name: 'Flat', valuation: '200000.00', valuationDate: '2026-09-30', mortgageDebt: '100000.00' }], tenancies: [], receipts: [], journalCoverage: [], data: { obligations: [], reserveTargets: [{ propertyId: 1, targetAmount: '1000.00' }] } }),
});
const features = (): ReviewFeatures => ({
  debts: { status: 'ready', data: { workspace: envelope({ debts: [] }), debts: [], accounts: [], owners: [], asOf: '2026-10-11' } },
  portfolio: { status: 'ready', data: { workspace: envelope({ holdings: [], platforms: [] }), accounts: [], analysis: analyzePortfolio({ holdings: [], platforms: [] }, [], '2026-10-11') } },
  pensions: { status: 'ready', data: { workspace: envelope([]), owners: [], pensionAccounts: [], summary: summarizePensionRecords([], []) } },
  property: { status: 'ready', data: property() },
  goals: { status: 'ready', data: { basis: 'manual_progress', goals: [{ id: 1, name: 'Deposit', targetAmount: '10000.00', currentAmount: '5000.00', targetDate: '2027-10-11', accountId: 1, status: 'active', progressPercent: 50 }] } },
});
function overview(): ReviewsOverview {
  const plan = buildFinancialPlan(input());
  const result: ReviewsOverview = {
    workspace: envelope(initialReviews), plan, context: context(), features: features(),
    source: { scope: 'household', cashAccessibility: 'confirmed', selectedOwnerId: 2, personalContextSaved: true, asOf: plan.asOf, periodStart: '2026-04-01', periodEnd: plan.asOf, transactionCount: 6, coverageMonths: ['2026-07', '2026-08', '2026-09'], latestTransactionDate: '2026-09-01', warnings: [] },
    actionQueue: [], comparison: null, recurringCandidates: plan.recurring, warnings: [],
  };
  result.actionQueue = buildReviewActionQueue({ ...result, profile: input().profile });
  return result;
}
const record = (overviewValue: ReviewsOverview, id = 'emergency-shortfall'): ActionRecord => {
  const action = overviewValue.actionQueue.find(entry => entry.action.id === id)!;
  return { id, evidenceFingerprint: action.evidenceFingerprint, status: 'completed', dueDate: null, note: 'Checked the statement' };
};

beforeEach(() => {
  vi.resetAllMocks();
  const fixture = overview();
  mocks.planning.mockResolvedValue({ input: input(), source: fixture.source, profileSaved: true });
  mocks.context.mockResolvedValue(envelope(fixture.context.data, fixture.context.revision));
  mocks.lookup.mockResolvedValue(fixture.context.lookup);
  mocks.read.mockResolvedValue(envelope(initialReviews));
  for (const key of ['debts', 'portfolio', 'pensions', 'property'] as const) {
    const feature = fixture.features[key];
    if (feature.status === 'ready') mocks[key].mockResolvedValue(feature.data);
  }
  mocks.goals.mockResolvedValue([{ id: 1, name: 'Deposit', targetAmount: '10000', currentAmount: '5000', targetDate: '2027-10-11', accountId: 1, status: 'active' }]);
  mocks.write.mockImplementation(async (_key, schema, data, revision) => envelope(schema.parse(data), revision + 1));
});

describe('review data availability and household snapshots', () => {
  it.each(['planning', 'context', 'lookup'] as const)('fails safely when essential %s cannot be loaded', async key => {
    mocks[key].mockRejectedValue(new Error('postgres://secret-credentials'));
    await expect(loadFinanceReviewWorkspace(now)).rejects.toBeInstanceOf(FinanceReviewUnavailableError);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('retains an explicit unavailable feature rather than an empty debt list or zero amount', async () => {
    mocks.debts.mockRejectedValue(new Error('postgres://secret-credentials'));
    const result = await loadFinanceReviewWorkspace(now);
    expect(result.features.debts).toMatchObject({ status: 'unavailable' });
    expect('data' in result.features.debts).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret-credentials');
    expect(result.actionQueue.some(entry => entry.action.id === 'workspace-debts-unavailable')).toBe(true);
    expect(createReviewSnapshot(result, now).workspaceRevisions).not.toHaveProperty('debts');
  });
  it('does not label a household plan with a different concurrently selected person', async () => {
    const conflicting = context();
    conflicting.data.ownerId = 3;
    mocks.context.mockResolvedValue(envelope(conflicting.data, 2));
    await expect(loadFinanceReviewWorkspace(now)).rejects.toBeInstanceOf(FinanceReviewUnavailableError);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('captures ledger household net worth exactly once and manual goals separately', async () => {
    const fixture = overview();
    if (fixture.features.pensions.status === 'ready') {
      const scheme = { id: 'bfbf3c70-775a-4d23-9062-2503d0b0289c', type: 'dc' as const, name: 'Unlinked pot', provider: null, ownerId: 2, statementAsOf: '2026-09-30', notes: null, linkedAccountId: null, potAmount: '777777.00', personalMonthlyContribution: '0.00', employerMonthlyContribution: '0.00', annualFeeRate: '0' };
      mocks.pensions.mockResolvedValue({ ...fixture.features.pensions.data, workspace: envelope([scheme]), summary: summarizePensionRecords([scheme], []) });
    }
    const result = await loadFinanceReviewWorkspace(now);
    const snapshot = createReviewSnapshot(result, now);
    expect(snapshot).toMatchObject({ scope: 'household', selectedOwnerId: 2, currency: 'GBP', metrics: { netWorth: '150900.00', debt: '100100.00', cashReserve: '1000.00' }, goals: { status: 'ready', data: { basis: 'manual_progress', goals: [{ currentAmount: '5000.00', progressPercent: 50 }] } } });
    expect(snapshot.metrics.netWorth).not.toBe('932677.00');
    expect(snapshot.period).toEqual({ start: '2026-07-01', end: '2026-09-30', monthsRecorded: 3 });
  });
  it('preserves unknown metrics when no accounts or transaction months are represented', async () => {
    const empty = { ...input(), accounts: [], properties: [], transactions: [], profile: {} };
    mocks.planning.mockResolvedValue({ input: empty, source: overview().source, profileSaved: false });
    const snapshot = createReviewSnapshot(await loadFinanceReviewWorkspace(now), now);
    expect(snapshot.metrics).toEqual({ monthlyIncome: null, monthlySpending: null, monthlySurplus: null, netWorth: null, cashReserve: null, reserveShortfall: null, debt: null });
    expect(snapshot.period.monthsRecorded).toBe(0);
  });
  it('derives manual progress percentages server-side and does not erase invalid progress to zero', async () => {
    mocks.goals.mockResolvedValue([{ id: 1, name: 'Third', targetAmount: '3', currentAmount: '1', targetDate: null, accountId: null, status: 'active' }]);
    const result = await loadFinanceReviewWorkspace(now);
    expect(result.features.goals).toMatchObject({ status: 'ready', data: { goals: [{ targetAmount: '3.00', currentAmount: '1.00', progressPercent: 33.33 }] } });
    mocks.goals.mockResolvedValue([{ id: 1, name: 'Invalid', targetAmount: '3', currentAmount: '-1', targetDate: null, accountId: null, status: 'active' }]);
    const failed = await loadFinanceReviewWorkspace(now);
    expect(createReviewSnapshot(failed, now).goals).toMatchObject({ status: 'unavailable' });
  });
});

describe('meaningful action evidence and review routes', () => {
  it('hashes canonical meaningful facts, independent of object key order', () => {
    expect(evidenceFingerprint('debts', 'debt-one', { apr: '5', balance: '100' })).toEqual(evidenceFingerprint('debts', 'debt-one', { balance: '100', apr: '5' }));
    expect(evidenceFingerprint('debts', 'debt-one', { balance: '100', apr: '5' })).not.toEqual(evidenceFingerprint('debts', 'debt-one', { balance: '99.99', apr: '5' }));
  });
  it('keeps decisions stable on the next day when relevant facts and completed-month periods are unchanged', () => {
    const original = overview();
    const saved = record(original);
    const next = { ...original, plan: { ...original.plan, asOf: '2026-10-12' }, workspace: envelope({ ...initialReviews, actions: [saved] }, 1) };
    expect(buildReviewActionQueue(next).find(entry => entry.action.id === saved.id)).toMatchObject({ evidenceFingerprint: saved.evidenceFingerprint, state: { status: 'completed', evidenceChanged: false, saved } });
    const changed = { ...next, plan: { ...next.plan, emergencyFund: { ...next.plan.emergencyFund, cashAvailable: 900, shortfall: 2100 } } };
    expect(buildReviewActionQueue(changed).find(entry => entry.action.id === saved.id)?.state).toMatchObject({ status: 'planned', evidenceChanged: true, saved });
  });
  it.each(['Shopping', 'Groceries'])('reopens an equally sized spending rise when the ledger category changes to %s', nextName => {
    const fixture = overview();
    const category = { name: 'Groceries', categoryId: 10, recentTotal: 750, previousTotal: 600, monthlyAverage: 250, previousMonthlyAverage: 200, monthlyChange: 50, changePercent: 25, transactionCount: 3, sharePercent: 50, personalTotal: 750, propertyTotal: 0 };
    const unchangedSameName = { ...category, categoryId: 9, monthlyAverage: 300, previousMonthlyAverage: 300, monthlyChange: 0, changePercent: 0 };
    fixture.plan.spending.categories = [unchangedSameName, category];
    fixture.plan.actions.push({ id: 'spending-trend', priority: 'medium', topic: 'spending', title: 'Understand the rise in Groceries', detail: 'Compare purchases.', evidence: 'Observed monthly spending rose by £50 (25%).', href: '/transactions', actionLabel: 'Compare spending', amount: 50, references: [] });
    fixture.actionQueue = buildReviewActionQueue(fixture);
    const saved = record(fixture, 'spending-trend');
    fixture.workspace.data.actions = [saved];
    expect(buildReviewActionQueue(fixture).find(entry => entry.action.id === saved.id)?.state).toMatchObject({ status: 'completed', evidenceChanged: false });
    fixture.plan.spending.categories = [unchangedSameName, { ...category, categoryId: 20, name: nextName }];
    fixture.plan.actions = fixture.plan.actions.map(action => action.id === saved.id ? { ...action, title: `Understand the rise in ${nextName}` } : action);
    const next = buildReviewActionQueue(fixture).find(entry => entry.action.id === saved.id)!;
    expect(next.evidenceFingerprint).not.toBe(saved.evidenceFingerprint);
    expect(next.state).toMatchObject({ status: 'planned', evidenceChanged: true, saved });
  });
  it('uses working context, pension, portfolio and property workspace routes', () => {
    const fixture = overview();
    fixture.context.data.ownerId = null;
    fixture.context.data.accountAccessibility = [];
    expect(buildReviewActionQueue(fixture).find(entry => entry.action.id === 'context-personal-details')?.action.href).toBe('/profile');
    expect(buildReviewActionQueue(fixture).find(entry => entry.action.id === 'retirement-review')?.action.href).toBe('/pensions/records');
    fixture.features.portfolio = { status: 'unavailable', error: 'Unavailable' };
    fixture.features.property = { status: 'unavailable', error: 'Unavailable' };
    const queue = buildReviewActionQueue(fixture);
    expect(queue.find(entry => entry.source === 'portfolio')?.action.href).toBe('/portfolio');
    expect(queue.find(entry => entry.source === 'property')?.action.href).toBe('/properties/operations');
  });
  it('keeps an overdue review date fingerprint stable without including the changing current day', () => {
    const fixture = overview();
    fixture.context.data.nextReviewDate = '2026-10-10';
    const first = buildReviewActionQueue(fixture).find(entry => entry.action.id === 'context-review-due')!;
    fixture.plan.asOf = '2026-10-20';
    expect(buildReviewActionQueue(fixture).find(entry => entry.action.id === first.action.id)?.evidenceFingerprint).toBe(first.evidenceFingerprint);
  });
  it('describes a scheduled rent gap as unreconciled and never establishes tenant arrears', () => {
    const fixture = overview();
    if (fixture.features.property.status !== 'ready') throw new Error('fixture');
    fixture.features.property.data.summary.properties[0].scheduledRent = '1000.00';
    fixture.features.property.data.summary.properties[0].recordedIncome = '800.00';
    fixture.features.property.data.summary.properties[0].unreconciledRentGap = '200.00';
    const rent = buildReviewActionQueue(fixture).find(entry => entry.action.id === 'property-rent-reconciliation-1')!;
    expect(rent.action.title).toContain('Reconcile');
    expect(rent.action.detail).toContain('does not establish tenant arrears');
    expect(rent.action.href).toBe('/properties/operations');
  });
});

describe('server review edit and snapshot boundaries', () => {
  it('rejects invented actions and stale changed decisions', () => {
    const fixture = overview();
    expect(() => validateReviewEdits({ actions: [{ ...record(fixture), id: 'fake' }], recurring: [] }, fixture)).toThrow(z.ZodError);
    expect(() => validateReviewEdits({ actions: [{ ...record(fixture), evidenceFingerprint: 'a'.repeat(64) }], recurring: [] }, fixture)).toThrow(WorkspaceConflictError);
  });
  it('retains unchanged stale history but does not authorize a new decision with old evidence', () => {
    const fixture = overview();
    const saved = { ...record(fixture), evidenceFingerprint: 'b'.repeat(64) };
    fixture.workspace = envelope({ ...initialReviews, actions: [saved] }, 1);
    expect(() => validateReviewEdits({ actions: [saved], recurring: [] }, fixture)).not.toThrow();
    expect(() => validateReviewEdits({ actions: [{ ...saved, note: 'new decision' }], recurring: [] }, fixture)).toThrow(WorkspaceConflictError);
    const historical = { ...saved, id: 'no-longer-current' };
    fixture.workspace.data.actions.push(historical);
    expect(() => validateReviewEdits({ actions: [historical], recurring: [] }, fixture)).not.toThrow();
    expect(() => validateReviewEdits({ actions: [{ ...historical, status: 'dismissed' }], recurring: [] }, fixture)).toThrow(z.ZodError);
  });
  it('permits edits to a previously saved merchant after payments disappear, but rejects invented new merchants', () => {
    const fixture = overview();
    const saved = { merchant: 'Old subscription', status: 'confirmed' as const, note: 'Cancelling', expectedMonthlySaving: '12' };
    fixture.workspace.data.recurring = [saved];
    expect(() => validateReviewEdits({ actions: [], recurring: [{ ...saved, merchant: 'old subscription', status: 'changed', note: 'Cancelled' }] }, fixture)).not.toThrow();
    expect(() => validateReviewEdits({ actions: [], recurring: [{ ...saved, merchant: 'Unseen merchant' }] }, fixture)).toThrow(z.ZodError);
  });
  it('preserves server snapshots and omitted user history when saving current decisions', async () => {
    const fixture = overview();
    const historical = { ...record(fixture), id: 'past-action', note: 'Important old note' };
    const previous = createReviewSnapshot(fixture, now);
    const merchant = { merchant: 'Old bill', status: 'changed' as const, note: 'Kept a record', expectedMonthlySaving: '1' };
    mocks.read.mockResolvedValue(envelope({ actions: [historical], recurring: [merchant], snapshots: [previous] }, 4));
    const current = record(fixture);
    const saved = await saveFinanceReviewWorkspace({ actions: [current], recurring: [] }, 4);
    expect(saved.data.actions).toEqual([historical, current]);
    expect(saved.data.recurring).toEqual([merchant]);
    expect(saved.data.snapshots).toEqual([previous]);
    expect(mocks.write.mock.calls[0][3]).toBe(4);
  });
  it('does not write stale workspace revisions', async () => {
    mocks.read.mockResolvedValue(envelope(initialReviews, 5));
    await expect(saveFinanceReviewWorkspace({ actions: [], recurring: [] }, 4)).rejects.toBeInstanceOf(WorkspaceConflictError);
    await expect(captureFinanceReview(4, now)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('captures fresh server metrics with bounded history and keeps the previous saved decisions', async () => {
    const fixture = overview();
    const prior = createReviewSnapshot(fixture, now);
    const savedAction = record(fixture);
    const snapshots = Array.from({ length: 60 }, (_, index) => reviewSnapshotSchema.parse({ ...prior, id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }));
    mocks.read.mockResolvedValue(envelope({ ...initialReviews, actions: [savedAction], snapshots }, 7));
    const captured = await captureFinanceReview(7, now);
    expect(captured.revision).toBe(8);
    expect(captured.data.actions).toEqual([savedAction]);
    expect(captured.data.snapshots).toHaveLength(60);
    expect(captured.data.snapshots[0].id).toBe(snapshots[1].id);
    expect(captured.data.snapshots.at(-1)).toMatchObject({ recordedAt: now.toISOString(), scope: 'household', metrics: { monthlySurplus: '1500.00', netWorth: '150900.00' } });
  });
  it('compares current facts with the last captured period without writing a GET snapshot', async () => {
    const prior = createReviewSnapshot(overview(), new Date('2026-09-11T12:00:00Z'));
    prior.asOf = '2026-09-11';
    prior.period = { start: '2026-06-01', end: '2026-08-31', monthsRecorded: 3 };
    prior.metrics.monthlySpending = '1500.01';
    mocks.read.mockResolvedValue(envelope({ ...initialReviews, snapshots: [prior] }, 1));
    const result = await loadFinanceReviewWorkspace(now);
    expect(result.comparison).toMatchObject({ samePeriod: false, monthlySpending: '-0.01', previousPeriod: prior.period, currentPeriod: { start: '2026-07-01', end: '2026-09-30' } });
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
