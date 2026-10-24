import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PayeeLearningContext, PayeeMemory } from '@/lib/categorization/payees/types';

const mocks = vi.hoisted(() => ({ list: vi.fn(), context: vi.fn(), save: vi.fn(), disable: vi.fn() }));
vi.mock('@/lib/categorization/payees/service', () => ({
  listPayeeMemories: mocks.list, getPayeeLearningContext: mocks.context, saveConfirmedPayee: mocks.save, disablePayeeMemory: mocks.disable,
  PayeeMemoryConflictError: class extends Error {}, InvalidPayeeMemoryError: class extends Error {},
}));
import { GET, POST } from './route';
import { GET as GET_CONTEXT } from './context/route';
import { POST as DISABLE } from './[id]/disable/route';
import { InvalidPayeeMemoryError, PayeeMemoryConflictError } from '@/lib/categorization/payees/service';

const id = '543508bc-71bc-428b-8e0e-f405a64b4983';
const snapshot = 'a'.repeat(32);
const memory: PayeeMemory = {
  id, revision: 1, status: 'active',
  scope: { accountId: 2, accountName: 'Household account', accountType: 'ASSET', ownerId: 1, direction: -1, currency: 'GBP', propertyId: null },
  payeeName: 'Sylvia', purpose: 'Household cleaner', categoryId: 7, categoryName: 'Cleaning', identityKind: 'bank_payee', aliases: ['Sylvia'],
  sourceJournalId: 12, createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:00:00.000Z',
};
const context: PayeeLearningContext = {
  record: { journalId: 12, snapshot, description: 'Payment to Sylvia REF October', merchantName: null, categoryId: null },
  scope: memory.scope, identities: [{ kind: 'bank_payee', value: 'Sylvia', label: 'Recognised bank payee' }], eligible: true, reason: null,
};
const choice = { journalId: 12, snapshot, categoryId: 7, payeeName: 'Sylvia', purpose: 'Household cleaner', identityKind: 'bank_payee', aliases: [] };
const request = (body: unknown) => new Request('https://app.test/api/categorization/payees', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.list.mockResolvedValue([memory]); mocks.context.mockResolvedValue(context);
  mocks.save.mockResolvedValue({ memory, journalId: 12, categoryId: 7, applied: true });
  mocks.disable.mockResolvedValue({ ...memory, status: 'disabled', revision: 2 });
});

describe('private payment knowledge APIs', () => {
  it('returns private validated knowledge and recorded context without inferred categories or public lookups', async () => {
    const response = await GET();
    expect(response.headers.get('Cache-Control')).toContain('private, no-store');
    expect(await response.json()).toEqual({ memories: [memory] });
    const detail = await GET_CONTEXT(new NextRequest('https://app.test/api/categorization/payees/context?journalId=12'));
    expect(detail.status).toBe(200);
    expect(await detail.json()).toEqual(context);
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(12);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('uses one atomic category-and-meaning write with the supplied current snapshot', async () => {
    const response = await POST(request(choice));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ applied: true, journalId: 12, categoryId: 7, memory: { id } });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(choice);
  });
  it.each([
    { ...choice, accountId: 5 }, { ...choice, ownerId: 2 }, { ...choice, propertyId: 9 },
    { ...choice, identityKind: 'contains' }, { ...choice, snapshot: 'old' },
    { ...choice, memoryId: id }, { ...choice, aliases: Array.from({ length: 9 }, () => 'Other') },
  ])('rejects stale, unscoped or unexpected save input without any write: %j', async input => {
    expect((await POST(request(input))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('reports a concurrent correction as a conflict without replaying or claiming a save', async () => {
    const conflict = new PayeeMemoryConflictError();
    conflict.message = 'The payment changed. Reload it before confirming.';
    mocks.save.mockRejectedValue(conflict);
    const response = await POST(request(choice));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'The payment changed. Reload it before confirming.' });
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('keeps ineligible or missing payment context distinct from unavailable storage', async () => {
    mocks.context.mockRejectedValue(new InvalidPayeeMemoryError('This transaction cannot become a recurring payee match.'));
    expect((await GET_CONTEXT(new NextRequest('https://app.test/api/categorization/payees/context?journalId=12'))).status).toBe(422);
    for (const query of ['journalId=-1', 'journalId=12&accountId=2', 'journalId=invalid']) {
      expect((await GET_CONTEXT(new NextRequest(`https://app.test/api/categorization/payees/context?${query}`))).status).toBe(400);
    }
  });
  it('disables only the selected current revision and keeps its acknowledgement private', async () => {
    const response = await DISABLE(request({ expectedRevision: 1 }), { params: Promise.resolve({ id }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ memory: { id, status: 'disabled', revision: 2 } });
    expect(mocks.disable).toHaveBeenCalledExactlyOnceWith(id, 1);
    expect((await DISABLE(request({ expectedRevision: 1, force: true }), { params: Promise.resolve({ id }) })).status).toBe(400);
    expect(mocks.disable).toHaveBeenCalledOnce();
  });
  it('does not expose private database errors or imply no write happened after an unverified save', async () => {
    mocks.save.mockRejectedValue(new Error('postgres://private secret-token'));
    const response = await POST(request(choice));
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).toContain('save could not be confirmed');
    expect(text).not.toContain('secret-token');
    expect(text).not.toContain('No changes');
    expect(mocks.save).toHaveBeenCalledOnce();
  });
  it('keeps malformed database DTOs unavailable rather than showing an empty memory list or a false acknowledgement', async () => {
    mocks.list.mockResolvedValue([{ ...memory, createdAt: '2026-10-24 18:00:00+00' }]);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty('memories');
    mocks.save.mockResolvedValue({ memory: { ...memory, updatedAt: 'invalid' }, journalId: 12, categoryId: 7, applied: true });
    expect((await POST(request(choice))).status).toBe(503);
    expect(mocks.save).toHaveBeenCalledOnce();
  });
});
