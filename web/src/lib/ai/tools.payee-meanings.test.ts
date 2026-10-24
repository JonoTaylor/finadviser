import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  context: vi.fn(), list: vi.fn(), save: vi.fn(), disable: vi.fn(),
  Conflict: class extends Error {}, Invalid: class extends Error {},
}));
vi.mock('@/lib/categorization/payees/service', () => ({
  getPayeeLearningContext: mocks.context, listPayeeMemories: mocks.list,
  saveConfirmedPayee: mocks.save, disablePayeeMemory: mocks.disable,
  loadActivePayeeMemories: vi.fn(), loadPrivatePayeeNames: vi.fn(),
  PayeeMemoryConflictError: mocks.Conflict, InvalidPayeeMemoryError: mocks.Invalid,
}));
import { executeTool } from './tools';

const snapshot = 'a'.repeat(32);
const input = { journal_id: 42, expected_snapshot: snapshot, category_id: 3,
  payee_name: 'Synthetic Cleaner', purpose: 'Personal household cleaning', identity_kind: 'bank_payee' };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.save.mockResolvedValue({ memory: { id: '349bc4c4-0757-4654-8bf6-a13fb4ce516d', revision: 1 }, journalId: 42, categoryId: 3, applied: true });
  mocks.list.mockResolvedValue([]);
});

describe('adviser private payment meaning tools', () => {
  it('saves confirmed meaning through the atomic server-scoped service', async () => {
    expect(await executeTool('remember_payment_payee', input)).toMatchObject({ saved: true, applied: true, journalId: 42 });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ journalId: 42, snapshot, categoryId: 3,
      payeeName: 'Synthetic Cleaner', purpose: 'Personal household cleaning', identityKind: 'bank_payee' });
  });
  it.each([
    { ...input, account_id: 99 }, { ...input, property_id: 1 }, { ...input, expected_snapshot: 'stale' },
    { ...input, memory_id: '349bc4c4-0757-4654-8bf6-a13fb4ce516d' }, { ...input, identity_kind: 'contains' },
  ])('rejects caller-chosen scopes and invalid confirmation inputs', async value => {
    expect(await executeTool('remember_payment_payee', value)).toMatchObject({ status: 'rejected' });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('does not expose or automatically repeat an unconfirmed write', async () => {
    mocks.save.mockRejectedValue(new Error('private database details and payment reference'));
    const result = await executeTool('remember_payment_payee', input);
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(mocks.save).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain('private database');
  });
  it('returns a conflict so the adviser reads the current revision before another save', async () => {
    mocks.save.mockRejectedValue(new mocks.Conflict());
    expect(await executeTool('remember_payment_payee', input)).toMatchObject({ status: 'conflict' });
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('keeps reading separate from saving and requires a revision to disable reuse', async () => {
    expect(await executeTool('list_payee_meanings', {})).toMatchObject({ meanings: [] });
    expect(mocks.save).not.toHaveBeenCalled();
    expect(await executeTool('disable_payee_meaning', { memory_id: '349bc4c4-0757-4654-8bf6-a13fb4ce516d' })).toMatchObject({ status: 'rejected' });
    expect(mocks.disable).not.toHaveBeenCalled();
  });
});
