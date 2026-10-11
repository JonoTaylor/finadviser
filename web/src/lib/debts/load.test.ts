import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), accounts: vi.fn(), balances: vi.fn(), owners: vi.fn() }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: mocks.read, writeWorkspace: mocks.write }));
vi.mock('@/lib/repos', () => ({ accountRepo: { listByType: mocks.accounts, getBalances: mocks.balances }, propertyRepo: { listOwners: mocks.owners } }));
vi.mock('@/lib/dates/today', () => ({ londonTodayIso: () => '2026-10-11' }));
import { loadDebtWorkspace, saveDebtWorkspace, DEBT_WORKSPACE_KEY } from './load';
import { debtWorkspaceSchema, type DebtRecord } from './types';

const record = (patch: Partial<DebtRecord> = {}): DebtRecord => ({
  id: 'bd737711-7f63-4e66-9d1b-00c94078801a', name: 'Card', accountId: 3, ownerId: null,
  statementBalance: null, statementAsOf: null, apr: '19.9', minimumPayment: '35.00',
  priority: false, inArrears: false, promotionalApr: null, promotionalExpiresOn: null,
  paymentRestrictions: '', feeNotes: '', ...patch,
});
const envelope = (debts = [record()]) => ({ version: 1 as const, revision: 2, updatedAt: '2026-10-11T10:00:00.000Z', data: { debts } });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.read.mockResolvedValue(envelope());
  mocks.write.mockImplementation(async (_key, _schema, data, revision) => ({ ...envelope(), revision: revision + 1, data }));
  mocks.accounts.mockResolvedValue([{ id: 3, name: 'Liabilities:Card', ownerId: 1, accountType: 'LIABILITY' }]);
  mocks.balances.mockResolvedValue([{ account_id: 3, account_name: 'Liabilities:Card', account_type: 'LIABILITY', balance: '-1400.75' }]);
  mocks.owners.mockResolvedValue([{ id: 1, name: 'Jono' }]);
});

describe('debt ledger adapter', () => {
  it('uses one authoritative dated ledger amount and account ownership', async () => {
    const result = await loadDebtWorkspace();
    expect(mocks.balances).toHaveBeenCalledWith('2026-10-11');
    expect(mocks.accounts).toHaveBeenCalledWith('LIABILITY');
    expect(result.debts[0]).toMatchObject({ effectiveBalance: '1400.75', balanceSource: 'ledger', balanceAsOf: '2026-10-11', ownerId: 1 });
    expect(result.workspace.data.debts[0].statementBalance).toBeNull();
  });
  it('does not mistake a liability credit for an amount owed', async () => {
    mocks.balances.mockResolvedValue([{ account_id: 3, balance: '20.00' }]);
    expect((await loadDebtWorkspace()).debts[0]).toMatchObject({ effectiveBalance: '0.00', sourceWarning: expect.stringContaining('in credit') });
  });
  it('uses a standalone statement only when unlinked', async () => {
    mocks.read.mockResolvedValue(envelope([record({ accountId: null, statementBalance: '500.00', statementAsOf: '2026-09-30' })]));
    expect((await loadDebtWorkspace()).debts[0]).toMatchObject({ effectiveBalance: '500.00', balanceSource: 'statement', balanceAsOf: '2026-09-30' });
  });
  it('keeps a missing or retyped account visibly unavailable', async () => {
    mocks.accounts.mockResolvedValue([]);
    expect((await loadDebtWorkspace()).debts[0]).toMatchObject({ effectiveBalance: null, balanceSource: 'unavailable' });
  });
  it('does not zero-fill a missing balance read', async () => {
    mocks.balances.mockResolvedValue([]);
    await expect(loadDebtWorkspace()).rejects.toThrow('unavailable');
  });
  it('uses current unallocated ledger ownership after an ownership change', async () => {
    mocks.read.mockResolvedValue(envelope([record({ ownerId: 1 })]));
    mocks.accounts.mockResolvedValue([{ id: 3, name: 'Card', ownerId: null }]);
    expect((await loadDebtWorkspace()).debts[0].ownerId).toBeNull();
  });
  it('does not project a saved future statement as today', async () => {
    mocks.read.mockResolvedValue(envelope([record({ accountId: null, statementBalance: '500.00', statementAsOf: '2026-12-01' })]));
    expect((await loadDebtWorkspace()).debts[0]).toMatchObject({ effectiveBalance: null, balanceSource: 'unavailable' });
  });
  it('passes the CAS revision and never writes the ledger', async () => {
    const result = await saveDebtWorkspace({ debts: [record({ ownerId: 1 })] }, 2);
    expect(mocks.write).toHaveBeenCalledWith(DEBT_WORKSPACE_KEY, debtWorkspaceSchema, { debts: [record({ ownerId: 1 })] }, 2);
    expect(result.workspace.revision).toBe(3);
  });
  it.each([
    record({ accountId: 999 }), record({ ownerId: 999 }),
    record({ accountId: null, statementBalance: '50.00', statementAsOf: '2026-10-12' }),
  ])('rejects invalid links, owners and future statements before writing', async debt => {
    await expect(saveDebtWorkspace({ debts: [debt] }, 0)).rejects.toThrow();
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects ownership that conflicts with the linked liability', async () => {
    mocks.owners.mockResolvedValue([{ id: 1, name: 'Jono' }, { id: 2, name: 'Other' }]);
    await expect(saveDebtWorkspace({ debts: [record({ ownerId: 2 })] }, 2)).rejects.toThrow('match');
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it('rejects duplicate links before loading or writing', async () => {
    await expect(saveDebtWorkspace({ debts: [record(), record({ id: 'd3fa92cd-4d57-4194-8218-dc93ac995cd4' })] }, 2)).rejects.toThrow('only once');
    expect(mocks.accounts).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
