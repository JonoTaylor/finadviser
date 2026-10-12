import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const { execute, loadFinancialContext, loadContextLookup, loadPlanningProfile, readWorkspace, counts } = vi.hoisted(() => ({ execute: vi.fn(), loadFinancialContext: vi.fn(), loadContextLookup: vi.fn(), loadPlanningProfile: vi.fn(), readWorkspace: vi.fn(), counts: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/finance-context', () => ({ loadFinancialContext }));
vi.mock('@/lib/finance-context/lookup', () => ({ loadContextLookup }));
vi.mock('@/lib/planning/load', () => ({ loadPlanningProfile }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace }));
vi.mock('@/lib/debts/load', () => ({ DEBT_WORKSPACE_KEY: 'finance.debts.v1' }));
vi.mock('@/lib/categorization/repository', () => ({ categorizationRepo: { counts } }));
import { contextSchema } from '@/lib/finance-context/schema';
import { loadDataIntelligence, loadLedgerCoverage, loadPropertyCoverage } from './load';

const dialect = new PgDialect();
const asOf = '2026-10-12';
const ledgerRow = { total_count: '20', uncategorised_count: '7', latest_date: asOf, recent_months: ['2026-07', '2026-08', '2026-09'], transfer_review_count: '2' };
beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.stubEnv('AI_GATEWAY_API_KEY', '');
  execute.mockImplementation(async query => {
    const text = dialect.sqlToQuery(query).sql;
    return text.includes('WITH recorded') ? { rows: [ledgerRow] } : { rows: [{ id: 1, name: 'Home', valuation_date: asOf, active_tenancy_count: '0', ownership_count: '1' }] };
  });
  counts.mockResolvedValue({ remaining: 5, needsReview: 2, available: 2, dismissed: 1, scopeAvailable: 2 });
  loadContextLookup.mockResolvedValue({ asOf, owners: [{ id: 2, name: 'Jono' }], accounts: [] });
  loadFinancialContext.mockResolvedValue({ revision: 1, data: contextSchema.parse({ ownerId: 2 }) });
  loadPlanningProfile.mockResolvedValue({ saved: false, profile: {} });
  readWorkspace.mockImplementation(async (_key, _schema, initial) => ({ revision: 0, data: initial }));
});

describe('bounded data intelligence loading', () => {
  it('loads aggregate counters and uses the same as-of date for current category decisions', async () => {
    expect(await loadLedgerCoverage(asOf)).toEqual({ totalCount: 20, uncategorisedCount: 7, latestDate: asOf, recentMonths: ['2026-07', '2026-08', '2026-09'], transferReviewCount: 2, reviewNeededCount: 2, eligibleCount: 5, unprocessedCount: 2 });
    expect(counts).toHaveBeenCalledWith({ asOf });
    const query = dialect.sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('COUNT(*)');
    expect(query.sql).toContain("a.account_type IN ('INCOME', 'EXPENSE')");
    expect(query.sql).not.toContain('je.description');
    expect(query.sql).not.toContain('transaction_metadata');
    expect(query.params).toContain('2026-07-01');
    expect(query.params).toContain('2026-10-01');
    expect(query.params).toContain(asOf);
  });
  it('keeps raw ledger counts known when the current categorisation backlog cannot be read', async () => {
    counts.mockRejectedValue(new Error('private credentials'));
    const report = await loadDataIntelligence(new Date('2026-10-12T12:00:00Z'));
    expect(report.status).toBe('partial');
    expect(report.transactions).toMatchObject({ totalCount: 20, uncategorisedCount: 7, reviewNeededCount: null, eligibleCount: null, unprocessedCount: null });
    expect(JSON.stringify(report)).not.toContain('private credentials');
  });
  it('does not interpret corrupt queue counters as zero', async () => {
    counts.mockResolvedValue({ remaining: null, needsReview: 'invalid', available: -1 });
    const coverage = await loadLedgerCoverage(asOf);
    expect(coverage.totalCount).toBe(20);
    expect(coverage.eligibleCount).toBeNull();
    expect(coverage.reviewNeededCount).toBeNull();
  });
  it.each([null, '-1', '1.5', 'not-a-count', '9007199254740992'])('rejects invalid aggregate count %s instead of making a financial zero', async total_count => {
    execute.mockResolvedValue({ rows: [{ ...ledgerRow, total_count }] });
    await expect(loadLedgerCoverage(asOf)).rejects.toThrow('coverage count');
  });
  it('rejects malformed recorded dates and month coverage', async () => {
    execute.mockResolvedValue({ rows: [{ ...ledgerRow, latest_date: '2026-02-30' }] });
    await expect(loadLedgerCoverage(asOf)).rejects.toThrow('coverage date');
    execute.mockResolvedValue({ rows: [{ ...ledgerRow, recent_months: ['2026-10'] }] });
    await expect(loadLedgerCoverage(asOf)).rejects.toThrow('month coverage');
  });
  it('retains an empty aggregate source as known empty rather than unavailable', async () => {
    execute.mockResolvedValueOnce({ rows: [{ total_count: '0', uncategorised_count: '0', latest_date: null, recent_months: [], transfer_review_count: '0' }] });
    counts.mockResolvedValue({ remaining: 0, needsReview: 0, available: 0 });
    const result = await loadLedgerCoverage(asOf);
    expect(result).toMatchObject({ totalCount: 0, uncategorisedCount: 0, latestDate: null, recentMonths: [] });
  });
  it('shares one reference lookup across context, debts, holdings and pensions', async () => {
    const report = await loadDataIntelligence(new Date('2026-10-12T12:00:00Z'));
    expect(report.asOf).toBe(asOf);
    expect(loadContextLookup).toHaveBeenCalledOnce();
    expect(readWorkspace).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalledTimes(2);
    expect(report.processing).toEqual({ modelAvailable: false, reviewUrl: '/data' });
    for (const call of execute.mock.calls) expect(dialect.sqlToQuery(call[0]).sql).not.toMatch(/\b(UPDATE|INSERT|DELETE)\b/i);
  });
  it('isolates an invalid saved pension inventory without treating it as absent', async () => {
    readWorkspace.mockImplementation(async (key, _schema, initial) => {
      if (key === 'finance.pension-records.v1') throw new Error('invalid private record');
      return { revision: 0, data: initial };
    });
    const report = await loadDataIntelligence(new Date('2026-10-12T12:00:00Z'));
    expect(report.status).toBe('partial');
    expect(report.coverage.find(item => item.domain === 'pensions')).toMatchObject({ status: 'unavailable', recordCount: null });
    expect(report.coverage.find(item => item.domain === 'properties')?.recordCount).toBe(1);
    expect(report.gaps.map(gap => gap.id)).not.toContain('pensions-inventory');
    expect(JSON.stringify(report)).not.toContain('invalid private record');
  });
  it('keeps failed shared references unknown without hiding separate property evidence', async () => {
    loadContextLookup.mockRejectedValue(new Error('lookup unavailable'));
    const report = await loadDataIntelligence(new Date('2026-10-12T12:00:00Z'));
    for (const domain of ['context', 'debts', 'portfolio', 'pensions']) expect(report.coverage.find(item => item.domain === domain)).toMatchObject({ status: 'unavailable', recordCount: null });
    expect(report.transactions.totalCount).toBe(20);
    expect(report.coverage.find(item => item.domain === 'properties')?.recordCount).toBe(1);
  });
  it('derives capability from server configuration and never returns the secret', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', 'private-model-secret');
    const report = await loadDataIntelligence(new Date('2026-10-12T12:00:00Z'));
    expect(report.processing.modelAvailable).toBe(true);
    expect(JSON.stringify(report)).not.toContain('private-model-secret');
    vi.unstubAllEnvs();
  });
  it('uses London calendar days for every source cutoff', async () => {
    const report = await loadDataIntelligence(new Date('2026-07-31T23:30:00Z'));
    expect(report.asOf).toBe('2026-08-01');
    expect(counts).toHaveBeenCalledWith({ asOf: '2026-08-01' });
  });
  it('reads property coverage without loading rent transactions or assuming an active tenancy', async () => {
    expect(await loadPropertyCoverage(asOf)).toEqual([{ id: 1, name: 'Home', valuationDate: asOf, activeTenancyCount: 0, ownershipCount: 1 }]);
    const query = dialect.sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain('COUNT(*) FROM tenancies');
    expect(query.sql).toContain('t.end_date >=');
    expect(query.sql).not.toContain('book_entries');
    expect(query.sql).not.toContain('journal_entries');
  });
});
