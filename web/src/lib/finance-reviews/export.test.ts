import { beforeEach, describe, expect, it, vi } from 'vitest';

const { context, profile, read, goals, accounts, owners } = vi.hoisted(() => ({
  context: vi.fn(), profile: vi.fn(), read: vi.fn(), goals: vi.fn(), accounts: vi.fn(), owners: vi.fn(),
}));
vi.mock('@/lib/finance-context', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-context')>(), loadFinancialContext: context,
}));
vi.mock('@/lib/planning/load', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/planning/load')>(), loadPlanningProfile: profile,
}));
vi.mock('@/lib/finance-workspace/store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-workspace/store')>(), readWorkspace: read,
}));
vi.mock('@/lib/repos/savings-goal.repo', () => ({ savingsGoalRepo: { getAll: goals } }));
vi.mock('@/lib/repos/account.repo', () => ({ accountRepo: { listAll: accounts } }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listOwners: owners } }));

import { loadFinancePlanningExport, FinanceExportUnavailableError } from './export';
import { defaultContext } from '@/lib/finance-context/schema';
import { WorkspaceStoredDataError } from '@/lib/finance-workspace/store';
import { InvalidPlanningProfileError, planningProfileSchema } from '@/lib/planning/load';
import { initialReviews } from './schema';

const now = new Date('2026-10-11T23:30:00.000Z');
const updatedAt = '2026-10-10T12:00:00.000Z';
const secret = 'postgres://private-user:private-password@private-host';
const envelope = <T>(data: T, revision = 4) => ({ version: 1 as const, revision, updatedAt: revision === 0 ? null : updatedAt, data });
const snapshot = {
  id: '7c480dd2-58fb-440c-acda-d08e855a35c5', recordedAt: updatedAt, asOf: '2026-10-10',
  scope: 'household', currency: 'GBP', selectedOwnerId: 2,
  period: { start: '2026-07-01', end: '2026-09-30', monthsRecorded: 2 },
  metrics: { monthlyIncome: '2000.00', monthlySpending: '1500.00', monthlySurplus: '500.00', netWorth: null, cashReserve: '1000.00', reserveShortfall: null, debt: '25.50' },
  workspaceRevisions: { context: 3, debts: 2 }, warnings: ['One recorded month is missing'],
};

beforeEach(() => {
  vi.resetAllMocks();
  context.mockResolvedValue(envelope({ ...defaultContext, ownerId: 2, dependants: null }));
  profile.mockResolvedValue({ profile: planningProfileSchema.parse({}), saved: false });
  read.mockImplementation(async (_key, _schema, initial) => envelope(initial, 0));
  goals.mockResolvedValue([]);
  accounts.mockResolvedValue([{ id: 5, name: 'Pension', accountType: 'ASSET', ownerId: 2 }]);
  owners.mockResolvedValue([{ id: 2, name: 'Jono' }]);
});

describe('scoped finance planning export', () => {
  it('declares the version, household scope, local as-of date and precise backup limitations', async () => {
    const data = await loadFinancePlanningExport(now);
    expect(data).toMatchObject({
      schemaVersion: 1, exportKind: 'finance-planning', scope: 'household', currency: 'GBP',
      exportedAt: now.toISOString(), asOf: '2026-10-12', completeBackup: false,
      consistency: 'independent_reads', availability: 'all_sections_available',
    });
    expect(data.omitted).toEqual(['ledger_rows', 'documents', 'files', 'credentials', 'bank_connections', 'other_settings']);
    expect(data.limitations).toContain('cannot restore the full app');
    expect(Object.keys(data.workspaces)).toEqual(['context', 'debts', 'portfolio', 'pensionRecords', 'propertyOperations', 'reviews']);
    expect(read.mock.calls.map(call => call[0]).sort()).toEqual([
      'finance.debts.v1', 'finance.pension-records.v1', 'finance.portfolio.v1', 'finance.property-operations.v1', 'finance.reviews.v1',
    ]);
  });

  it('keeps unknowns, saved status, workspace revisions and past snapshot scope without recalculating them', async () => {
    read.mockImplementation(async (key, _schema, initial) => key === 'finance.reviews.v1'
      ? envelope({ ...initialReviews, snapshots: [snapshot] }, 8) : envelope(initial, 0));
    const data = await loadFinancePlanningExport(now);
    expect(data.workspaces.context).toMatchObject({ status: 'available', workspace: { revision: 4, updatedAt, data: { dependants: null, ownerId: 2 } } });
    expect(data.planningProfile).toMatchObject({ status: 'available', saved: false, profile: { essentialMonthlySpending: null, riskTolerance: null, retirementScenario: null } });
    expect(data.workspaces.reviews).toEqual({ status: 'available', key: 'finance.reviews.v1', workspace: envelope({ ...initialReviews, snapshots: [snapshot] }, 8) });
    expect(data.workspaces.portfolio).toMatchObject({ status: 'available', workspace: { revision: 0, updatedAt: null, data: { holdings: [], platforms: [] } } });
  });

  it('preserves statement dates, money strings, unknown contributions and linked IDs', async () => {
    const records = [{
      id: 'ca9bc8fb-af61-4603-a837-579f81f1b6d5', name: 'Workplace pension', type: 'dc', provider: null,
      ownerId: 2, linkedAccountId: 5, potAmount: null, personalMonthlyContribution: '100.01',
      employerMonthlyContribution: null, annualFeeRate: null, statementAsOf: '2026-10-01', notes: null,
    }];
    read.mockImplementation(async (key, _schema, initial) => envelope(key === 'finance.pension-records.v1' ? records : initial));
    const data = await loadFinancePlanningExport(now);
    expect(data.workspaces.pensionRecords).toMatchObject({ status: 'available', workspace: { data: records } });
  });

  it('whitelists reference and goal fields so added private fields cannot leak into the file', async () => {
    accounts.mockResolvedValue([{ id: 5, name: 'Pension', accountType: 'ASSET', ownerId: null, description: secret, bankToken: secret, balance: '999.99' }]);
    owners.mockResolvedValue([{ id: 2, name: 'Jono', privateCredential: secret, createdAt: now }]);
    goals.mockResolvedValue([{
      id: 1, name: 'Holiday', targetAmount: '5000.00', currentAmount: '100.01', targetDate: null, accountId: 5,
      status: 'active', createdAt: now, updatedAt: now, secret,
    }]);
    const data = await loadFinancePlanningExport(now);
    expect(data.references).toEqual({ status: 'available', data: {
      accounts: [{ id: 5, name: 'Pension', accountType: 'ASSET', ownerId: null }], owners: [{ id: 2, name: 'Jono' }],
    } });
    expect(data.savingsGoals).toEqual({ status: 'available', data: [{
      id: 1, name: 'Holiday', targetAmount: '5000.00', currentAmount: '100.01', targetDate: null,
      accountId: 5, status: 'active', createdAt: now.toISOString(), updatedAt: now.toISOString(),
    }] });
    expect(JSON.stringify(data)).not.toContain(secret);
    expect(JSON.stringify(data)).not.toContain('999.99');
  });

  it('marks each optional failed section unavailable without substituting an empty workspace or revealing error details', async () => {
    read.mockImplementation(async (key, _schema, initial) => {
      if (key === 'finance.debts.v1') throw new WorkspaceStoredDataError();
      if (key === 'finance.reviews.v1') throw new Error(secret);
      return envelope(initial, 0);
    });
    goals.mockRejectedValue(new Error(secret));
    accounts.mockRejectedValue(new Error(secret));
    const data = await loadFinancePlanningExport(now);
    expect(data.availability).toBe('some_sections_unavailable');
    expect(data.workspaces.debts).toMatchObject({ status: 'unavailable', code: 'WORKSPACE_INVALID' });
    for (const section of [data.workspaces.debts, data.workspaces.reviews, data.savingsGoals, data.references]) {
      expect(section.status).toBe('unavailable');
      expect(section).not.toHaveProperty('workspace');
      expect(section).not.toHaveProperty('data');
    }
    expect(JSON.stringify(data)).not.toContain(secret);
  });

  it.each(['context', 'planningProfile'] as const)('refuses a download when essential %s cannot be read', async section => {
    (section === 'context' ? context : profile).mockRejectedValue(new Error(secret));
    await expect(loadFinancePlanningExport(now)).rejects.toMatchObject({
      name: 'FinanceExportUnavailableError', section, code: 'ESSENTIAL_SECTION_UNAVAILABLE',
    });
    await expect(loadFinancePlanningExport(now)).rejects.not.toThrow(secret);
  });

  it('distinguishes corrupt essential context and profile while keeping private exception text out', async () => {
    context.mockRejectedValueOnce(new WorkspaceStoredDataError());
    await expect(loadFinancePlanningExport(now)).rejects.toMatchObject({ section: 'context', code: 'ESSENTIAL_SECTION_INVALID' });
    profile.mockRejectedValueOnce(new InvalidPlanningProfileError());
    await expect(loadFinancePlanningExport(now)).rejects.toBeInstanceOf(FinanceExportUnavailableError);
    profile.mockResolvedValueOnce({ profile: { secret }, saved: true });
    await expect(loadFinancePlanningExport(now)).rejects.toMatchObject({ section: 'planningProfile', code: 'ESSENTIAL_SECTION_INVALID' });
  });
});
