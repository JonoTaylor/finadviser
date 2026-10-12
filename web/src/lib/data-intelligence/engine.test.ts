import { describe, expect, it } from 'vitest';
import { buildDataIntelligence, completedRecentMonths } from './engine';
import { contextSchema, type ContextLookup } from '@/lib/finance-context/schema';
import type { DataIntelligenceInput } from './types';
import type { PensionRecord } from '@/lib/pension-records/schema';

const asOf = '2026-10-12';
const dc: PensionRecord = { id: '11111111-1111-4111-8111-111111111111', type: 'dc', name: 'Recorded scheme', provider: 'Provider', ownerId: 2, statementAsOf: asOf, notes: null, linkedAccountId: 3, potAmount: null, personalMonthlyContribution: '0.00', employerMonthlyContribution: '0.00', annualFeeRate: '0' };
const state: PensionRecord = { id: '22222222-2222-4222-8222-222222222222', type: 'state', name: 'My forecast', provider: null, ownerId: 2, statementAsOf: asOf, notes: null, forecastAnnualIncome: '0.00', forecastSourceDate: asOf, startAge: 68 };
function completeInput(): DataIntelligenceInput {
  const lookup: ContextLookup = { asOf, owners: [{ id: 1, name: 'Another owner' }, { id: 2, name: 'Selected person' }], accounts: [
    { id: 1, name: 'Current bank account', accountType: 'ASSET', isInvestment: false, investmentKind: null, ownerId: 2, balance: '0.00', latestJournalDate: asOf, postingCount: 1, futurePostingCount: 0 },
    { id: 2, name: 'Credit card', accountType: 'LIABILITY', isInvestment: false, investmentKind: null, ownerId: 2, balance: '-10.00', latestJournalDate: asOf, postingCount: 1, futurePostingCount: 0 },
    { id: 3, name: 'Pension ledger', accountType: 'ASSET', isInvestment: true, investmentKind: 'pension', ownerId: 2, balance: '100.00', latestJournalDate: asOf, postingCount: 1, futurePostingCount: 0 },
  ] };
  return {
    asOf,
    ledger: { status: 'ready', data: { totalCount: 10, uncategorisedCount: 0, reviewNeededCount: 0, eligibleCount: 0, unprocessedCount: 0, transferReviewCount: 0, latestDate: asOf, recentMonths: ['2026-07', '2026-08', '2026-09'] } },
    context: { status: 'ready', data: { saved: true, data: contextSchema.parse({ ownerId: 2, taxResidence: 'england', dependants: 0, employmentStability: 'stable', accountAccessibility: [{ accountId: 1, accessibility: 'available' }] }), lookup } },
    planning: { status: 'ready', data: { saved: true, profile: { essentialMonthlySpending: 0, investmentHorizonYears: 0, riskTolerance: 'low', currentAge: 40, retirementAge: 65, targetRetirementIncome: 0 } } },
    debts: { status: 'ready', data: { records: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Card', accountId: 2, ownerId: 2, statementBalance: null, statementAsOf: null, apr: '0', minimumPayment: '0.00', priority: false, inArrears: false, promotionalApr: null, promotionalExpiresOn: null, paymentRestrictions: '', feeNotes: '' }], lookup } },
    portfolio: { status: 'ready', data: { data: { holdings: [{ id: 'holding', accountId: 3, name: 'Recorded fund', assetClass: 'equity', currency: 'GBP', value: '100.00', valuationDate: asOf, feeRate: '0', provider: null }], platforms: [{ accountId: 3, feeRate: '0' }] }, lookup } },
    pensions: { status: 'ready', data: { records: [dc, state], lookup } },
    properties: { status: 'ready', data: { records: [{ id: 1, name: 'Recorded property', valuationDate: asOf, ownershipCount: 1, activeTenancyCount: 1 }], data: { reserveTargets: [{ propertyId: 1, targetAmount: '0.00' }], obligations: [] } } },
  };
}

describe('data intelligence evidence', () => {
  it('keeps explicitly recorded zeros and zero fees distinct from missing data', () => {
    const report = buildDataIntelligence(completeInput());
    expect(report.gaps).toEqual([]);
    expect(report.coverage.every(source => source.status === 'recorded')).toBe(true);
    expect(report.status).toBe('ready');
    expect(report.scope).toBe('household');
  });
  it('does not use unsaved planning values as confirmed facts', () => {
    const input = completeInput();
    if (input.planning.status === 'ready') input.planning.data.saved = false;
    const report = buildDataIntelligence(input);
    expect(report.gaps.map(gap => gap.id)).toContain('essential-spending');
    expect(report.gaps.map(gap => gap.id)).toContain('investment-context');
    expect(report.coverage.find(source => source.domain === 'planning')?.status).toBe('empty');
  });
  it('does not infer confirmed values from an empty inventory', () => {
    const input = completeInput();
    input.ledger = { status: 'ready', data: { totalCount: 0, uncategorisedCount: 0, reviewNeededCount: 0, eligibleCount: 0, unprocessedCount: 0, transferReviewCount: 0, latestDate: null, recentMonths: [] } };
    input.context = { status: 'ready', data: { saved: false, data: contextSchema.parse({}), lookup: { asOf, owners: [], accounts: [] } } };
    input.planning = { status: 'ready', data: { saved: false, profile: {} } };
    input.debts = { status: 'ready', data: { records: [], lookup: { asOf, owners: [], accounts: [] } } };
    input.portfolio = { status: 'ready', data: { data: { holdings: [], platforms: [] }, lookup: { asOf, owners: [], accounts: [] } } };
    input.pensions = { status: 'ready', data: { records: [], lookup: { asOf, owners: [], accounts: [] } } };
    input.properties = { status: 'ready', data: { records: [], data: { obligations: [], reserveTargets: [] } } };
    const report = buildDataIntelligence(input);
    expect(report.coverage.every(source => source.status === 'empty')).toBe(true);
    expect(report.gaps.map(gap => gap.id)).toContain('transactions-empty');
    expect(report.gaps.map(gap => gap.id)).toContain('pensions-inventory');
    expect(report.gaps.find(gap => gap.id === 'pensions-inventory')?.reason).toContain('does not establish that you have no pensions');
    expect(report.gaps.map(gap => gap.id)).not.toContain('state-pension-forecast');
    expect(report).not.toHaveProperty('netWorth');
    expect(report).not.toHaveProperty('monthlyIncome');
  });
  it('keeps failed sources unavailable with unknown counters instead of false zeros', () => {
    const input = completeInput();
    for (const domain of ['ledger', 'context', 'planning', 'debts', 'portfolio', 'pensions', 'properties'] as const) input[domain] = { status: 'unavailable' };
    const report = buildDataIntelligence(input);
    expect(report.status).toBe('unavailable');
    expect(report.transactions).toMatchObject({ status: 'unavailable', totalCount: null, unprocessedCount: null, uncategorisedCount: null, reviewNeededCount: null, transferReviewCount: null });
    expect(report.transactions.missingRecentMonths).toEqual([]);
    expect(report.coverage.every(source => source.status === 'unavailable' && source.recordCount === null)).toBe(true);
    expect(report.gaps.every(gap => gap.status === 'unavailable')).toBe(true);
  });
  it('isolates an unavailable pension workspace while preserving known transaction counts', () => {
    const input = completeInput();
    input.pensions = { status: 'unavailable' };
    const report = buildDataIntelligence(input);
    expect(report.status).toBe('partial');
    expect(report.transactions.totalCount).toBe(10);
    expect(report.gaps.find(gap => gap.domain === 'pensions')).toMatchObject({ status: 'unavailable', affectedCount: null });
    expect(report.gaps.map(gap => gap.id)).not.toContain('pensions-inventory');
  });
  it('reports processing unavailable without hiding aggregate ledger coverage', () => {
    const input = completeInput();
    if (input.ledger.status === 'ready') input.ledger.data = { ...input.ledger.data, reviewNeededCount: null, unprocessedCount: null, eligibleCount: null };
    const report = buildDataIntelligence(input);
    expect(report.status).toBe('partial');
    expect(report.transactions.totalCount).toBe(10);
    expect(report.gaps.map(gap => gap.id)).toContain('category-queue-unavailable');
  });
  it('excludes the current month and handles the year boundary', () => {
    expect(completedRecentMonths('2026-01-03')).toEqual(['2025-10', '2025-11', '2025-12']);
    const input = completeInput();
    if (input.ledger.status === 'ready') input.ledger.data.recentMonths = ['2026-07', '2026-10'];
    const report = buildDataIntelligence(input);
    expect(report.transactions.missingRecentMonths).toEqual(['2026-08', '2026-09']);
    expect(report.gaps.find(gap => gap.id === 'transactions-months')?.reason).toContain('rather than proven zero');
  });
  it.each([['2026-09-12', false], ['2026-09-11', true]])('uses a disclosed 30 day freshness threshold for %s', (latestDate, stale) => {
    const input = completeInput();
    if (input.ledger.status === 'ready') input.ledger.data.latestDate = latestDate;
    const gap = buildDataIntelligence(input).gaps.find(gap => gap.id === 'transactions-stale');
    expect(Boolean(gap)).toBe(stale);
    if (gap) expect(gap.reason).toContain('30 days');
  });
  it('distinguishes eligible unprocessed items, uncategorised records and pending decisions', () => {
    const input = completeInput();
    if (input.ledger.status === 'ready') input.ledger.data = { ...input.ledger.data, uncategorisedCount: 7, eligibleCount: 5, unprocessedCount: 2, reviewNeededCount: 2, transferReviewCount: 1 };
    const report = buildDataIntelligence(input, true);
    expect(report.transactions).toMatchObject({ uncategorisedCount: 7, eligibleCount: 5, unprocessedCount: 2, reviewNeededCount: 2 });
    expect(report.processing).toEqual({ modelAvailable: true, reviewUrl: '/data' });
    expect(report.gaps.find(gap => gap.id === 'transactions-review')).toMatchObject({ affectedCount: 2, action: { href: '/data', kind: 'confirm' } });
    expect(report.gaps.find(gap => gap.id === 'transfers-review')?.action.href).toBe('/transactions/transfers');
  });
  it('does not ask AI to repeatedly categorise ineligible opening or valuation records', () => {
    const input = completeInput();
    if (input.ledger.status === 'ready') input.ledger.data.uncategorisedCount = 3;
    const report = buildDataIntelligence(input);
    expect(report.transactions.uncategorisedCount).toBe(3);
    expect(report.gaps.map(gap => gap.id)).not.toContain('transactions-uncategorised');
    expect(report.coverage.find(source => source.domain === 'transactions')?.evidence.join(' ')).toContain('opening balances');
  });
  it('never chooses the first owner and keeps household source labels explicit', () => {
    const input = completeInput();
    if (input.context.status === 'ready') input.context.data.data.ownerId = null;
    const report = buildDataIntelligence(input);
    expect(report.gaps.map(gap => gap.id)).toContain('context-owner');
    expect(report.gaps.map(gap => gap.id)).not.toContain('state-pension-forecast');
    expect(report.scope).toBe('household');
  });
  it('does not request a personal State Pension forecast for a removed saved owner', () => {
    const input = completeInput();
    if (input.context.status === 'ready') input.context.data.data.ownerId = 999;
    const report = buildDataIntelligence(input);
    expect(report.gaps.map(gap => gap.id)).toContain('context-owner');
    expect(report.gaps.map(gap => gap.id)).not.toContain('state-pension-forecast');
  });
  it('flags a future debt statement rather than presenting it as current evidence', () => {
    const input = completeInput();
    if (input.debts.status === 'ready') input.debts.data.records[0] = { ...input.debts.data.records[0], accountId: null, statementBalance: '10.00', statementAsOf: '2026-11-01' };
    const gap = buildDataIntelligence(input).gaps.find(gap => gap.id === 'debts-future-statements');
    expect(gap?.status).toBe('incomplete');
    expect(gap?.reason).toContain('cannot establish the amount owed');
  });
  it('does not request repayment terms for a recorded debt with no amount owed', () => {
    const input = completeInput();
    if (input.debts.status === 'ready') {
      input.debts.data.lookup = { ...input.debts.data.lookup, accounts: input.debts.data.lookup.accounts.map(account => account.id === 2 ? { ...account, balance: '0.00' } : account) };
      input.debts.data.records[0] = { ...input.debts.data.records[0], apr: null, minimumPayment: null };
    }
    expect(buildDataIntelligence(input).gaps.map(gap => gap.id)).not.toContain('debts-terms');
  });
  it('preserves unknown pension amounts and missing source dates without inferring employer contributions', () => {
    const input = completeInput();
    if (input.pensions.status === 'ready') input.pensions.data.records = [{ ...dc, employerMonthlyContribution: null }, { ...state, forecastAnnualIncome: null, forecastSourceDate: null }];
    const report = buildDataIntelligence(input);
    expect(report.gaps.find(gap => gap.id === 'pensions-details')).toMatchObject({ affectedCount: 2, status: 'incomplete' });
    expect(report.gaps.find(gap => gap.id === 'pensions-details')?.reason).toContain('not inferred');
  });
  it('finds a pension account with no scheme inventory instead of inventing scheme details', () => {
    const input = completeInput();
    if (input.pensions.status === 'ready') input.pensions.data.records = [state];
    const report = buildDataIntelligence(input);
    expect(report.gaps.find(gap => gap.id === 'pensions-inventory')).toMatchObject({ affectedCount: 1, priority: 'high' });
  });
  it('treats a missing linked pension account as unknown even if a pot was recorded elsewhere', () => {
    const input = completeInput();
    if (input.pensions.status === 'ready') input.pensions.data.records = [{ ...dc, linkedAccountId: 999 }, state];
    expect(buildDataIntelligence(input).gaps.find(gap => gap.id === 'pensions-details')?.affectedCount).toBe(1);
  });
  it('flags a negative linked pension pot as invalid source evidence', () => {
    const input = completeInput();
    if (input.pensions.status === 'ready') input.pensions.data.lookup = { ...input.pensions.data.lookup, accounts: input.pensions.data.lookup.accounts.map(account => account.id === 3 ? { ...account, balance: '-1.00' } : account) };
    const gap = buildDataIntelligence(input).gaps.find(gap => gap.id === 'pensions-details');
    expect(gap?.affectedCount).toBe(1);
    expect(gap?.reason).toContain('negative linked pot');
  });
  it('detects holdings reconciliation and unknown fees without recommending an asset mix', () => {
    const input = completeInput();
    if (input.portfolio.status === 'ready') {
      input.portfolio.data.data.holdings[0].value = '20.00';
      input.portfolio.data.data.holdings[0].feeRate = null;
    }
    const report = buildDataIntelligence(input);
    expect(report.gaps.find(gap => gap.id === 'portfolio-holdings')?.affectedCount).toBe(1);
    expect(report.gaps.find(gap => gap.id === 'portfolio-fees')?.reason).toContain('cannot be treated as free');
    expect(report).not.toHaveProperty('recommendedAllocation');
  });
  it('does not treat a future holding valuation as usable allocation evidence', () => {
    const input = completeInput();
    if (input.portfolio.status === 'ready') input.portfolio.data.data.holdings[0].valuationDate = '2026-11-01';
    const report = buildDataIntelligence(input);
    expect(report.gaps.find(gap => gap.id === 'portfolio-future-valuations')).toMatchObject({ priority: 'high', affectedCount: 1, status: 'incomplete' });
    expect(report.coverage.find(source => source.domain === 'portfolio')?.status).toBe('incomplete');
  });
  it('does not assume a home without tenancy data is missing rent', () => {
    const input = completeInput();
    if (input.properties.status === 'ready') input.properties.data.records[0].activeTenancyCount = 0;
    const gap = buildDataIntelligence(input).gaps.find(gap => gap.id === 'property-tenancies');
    expect(gap?.reason).toContain('home, vacant');
    expect(gap?.action.kind).toBe('confirm');
  });
  it.each([['2025-10-12', false], ['2025-10-11', true]])('discloses the 365 day property valuation threshold for %s', (valuationDate, stale) => {
    const input = completeInput();
    if (input.properties.status === 'ready') input.properties.data.records[0].valuationDate = valuationDate;
    expect(Boolean(buildDataIntelligence(input).gaps.find(gap => gap.id === 'property-values-stale'))).toBe(stale);
  });
  it('gives missing property ownership priority over optional property use confirmation', () => {
    const input = completeInput();
    if (input.properties.status === 'ready') input.properties.data.records[0] = { ...input.properties.data.records[0], valuationDate: null, ownershipCount: 0, activeTenancyCount: 0 };
    const report = buildDataIntelligence(input);
    const propertyGaps = report.gaps.filter(gap => gap.domain === 'properties');
    expect(propertyGaps[0].id).toBe('property-ownership');
    expect(propertyGaps.every(gap => gap.source.length > 0 && gap.evidence.length > 0)).toBe(true);
  });
  it('provides only actual contextual routes and remains deterministic', () => {
    const input = completeInput();
    if (input.context.status === 'ready') input.context.data.data.nextReviewDate = '2026-10-10';
    if (input.pensions.status === 'ready') input.pensions.data.records = [];
    const report = buildDataIntelligence(input);
    expect(report).toEqual(buildDataIntelligence(input));
    expect(report.gaps.find(gap => gap.id === 'review-due')?.action.href).toBe('/review');
    expect(report.gaps.filter(gap => gap.domain === 'pensions').every(gap => gap.action.href === '/pensions/records')).toBe(true);
    expect(report.gaps.every(gap => gap.action.href.startsWith('/') && !gap.action.href.startsWith('//'))).toBe(true);
  });
});
