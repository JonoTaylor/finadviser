import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), owners: vi.fn(), read: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ propertyRepo: { listOwners: mocks.owners } }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: mocks.read }));
import { loadPensionRecordsWorkspace } from './load';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema } from './schema';

beforeEach(() => {
  mocks.execute.mockReset(); mocks.owners.mockReset(); mocks.read.mockReset();
  mocks.execute.mockResolvedValue({ rows: [{ id: 4, name: 'Pension', owner_id: 1, owner_name: 'Jono', balance: '10000.01' }] });
  mocks.owners.mockResolvedValue([{ id: 1, name: 'Jono', createdAt: new Date() }]);
  mocks.read.mockResolvedValue({ version: 1, revision: 0, updatedAt: null, data: [] });
});

describe('pension inventory loader', () => {
  it('loads only pension ASSET investment account balances as of the London current date', async () => {
    const result = await loadPensionRecordsWorkspace();
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain("a.account_type = 'ASSET'");
    expect(query.sql).toContain('a.is_investment = true');
    expect(query.sql).toContain("a.investment_kind = 'pension'");
    expect(query.sql).toContain('v_account_balances');
    expect(query.sql).toContain('future_journal.date >');
    expect(query.params).toContain(result.pensionAccounts[0].balanceAsOf);
    expect(result.pensionAccounts[0].balance).toBe('10000.01');
    expect(result.owners).toEqual([{ id: 1, name: 'Jono' }]);
    expect(mocks.read).toHaveBeenCalledWith(PENSION_RECORDS_KEY, pensionRecordsDataSchema, []);
    expect(result.summary.dc.pot.knownTotal).toBeNull();
  });

  it('returns separate summaries for persisted records without converting promised income to capital', async () => {
    const db = { id: '00000000-0000-4000-8000-000000000001', name: 'DB', provider: null, ownerId: 1, statementAsOf: null, notes: null, type: 'db', promisedAnnualIncome: '5000.00', startAge: null };
    mocks.read.mockResolvedValue({ version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00Z', data: [db] });
    const result = await loadPensionRecordsWorkspace();
    expect(result.summary.dc.pot.knownTotal).toBeNull();
    expect(result.summary.db.annualIncome.knownTotal).toBe('5000.00');
    expect(result.workspace.data).toEqual([db]);
  });

  it('does not turn failed ledger reads into an empty inventory', async () => {
    mocks.execute.mockRejectedValue(new Error('database unavailable'));
    await expect(loadPensionRecordsWorkspace()).rejects.toThrow('database unavailable');
  });
});
