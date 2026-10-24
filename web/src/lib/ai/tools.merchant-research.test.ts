import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ records: vi.fn(), owners: vi.fn(), research: vi.fn(), confirm: vi.fn(), process: vi.fn(), privateNames: vi.fn() }));
vi.mock('@/lib/categorization/payees/service', () => ({ loadPrivatePayeeNames: mocks.privateNames }));
vi.mock('@/lib/repos', () => ({
  accountRepo: {}, journalRepo: {}, categoryRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {}, aiMemoryRepo: {}, ownerTaxRepo: {},
  propertyRepo: { listOwners: mocks.owners },
}));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
vi.mock('@/lib/merchant-research/service', () => ({ researchMerchant: mocks.research }));
vi.mock('@/lib/categorization/review', () => ({
  getCategorizationRecords: mocks.records, confirmedCategorize: mocks.confirm,
  CategorizationConflictError: class extends Error {}, InvalidCategorizationError: class extends Error {},
}));

import { executeTool, TOOL_DEFINITIONS } from './tools';

const record = {
  journalId: 42, date: '2026-10-01', description: 'private bank memo 12345678', merchantName: 'Example Cafe',
  transactionType: 'card_payment', currency: 'GBP', bankCategory: null, propertyId: 9,
  categoryId: null, snapshot: 'a'.repeat(32), isTransfer: false, pendingTransfer: false,
  legs: [
    { accountId: 1, accountName: 'Private bank', accountType: 'ASSET', ownerId: 7, amount: '-12.35' },
    { accountId: 2, accountName: 'Uncategorised expense', accountType: 'EXPENSE', ownerId: null, amount: '12.35' },
  ],
};
const result = {
  status: 'matched', query: 'Example Cafe business merchant', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
  researchedAt: '2026-10-24T12:00:00.000Z',
  sources: [{ title: 'Example Cafe', url: 'https://cafe.co.uk/', snippet: 'Cafe and coffee shop.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.records.mockResolvedValue([record]);
  mocks.owners.mockResolvedValue([{ id: 7, name: 'Private Owner' }]);
  mocks.research.mockResolvedValue(result);
  mocks.privateNames.mockResolvedValue([]);
});

describe('record-scoped public merchant research', () => {
  it('keeps remembered private payees out of direct public lookups too', async () => {
    mocks.privateNames.mockResolvedValue(['Private Cleaner']);
    mocks.records.mockResolvedValue([{ ...record, merchantName: 'Private Cleaner' }]);
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status: 'skipped_private' });
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it('fails closed when remembered private identities cannot be read', async () => {
    mocks.privateNames.mockRejectedValue(new Error('Private database detail'));
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status: 'unavailable' });
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it('selects the stored public merchant while keeping financial details out of the search input', async () => {
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ ...result, journalId: 42 });
    expect(mocks.records).toHaveBeenCalledExactlyOnceWith([42]);
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith({
      merchantName: 'Example Cafe', transactionType: 'card_payment', privateNames: ['Private Owner'],
    });
    const forwarded = JSON.stringify(mocks.research.mock.calls);
    for (const privateDetail of ['12345678', '12.35', '2026-10-01', 'Private bank', 'propertyId']) expect(forwarded).not.toContain(privateDetail);
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it.each([
    {}, { journal_id: 0 }, { journal_id: 1.5 }, { journal_id: '42' }, { journal_id: 42, query: 'private memo' },
    { journal_id: 42, merchant_name: 'arbitrary external query' }, { journal_id: 42, coarse_location: 'private address' },
  ])('rejects arbitrary query fields and malformed IDs before reading or searching: %j', async input => {
    expect(await executeTool('research_merchant', input)).toHaveProperty('error');
    expect(mocks.records).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it.each([
    { isTransfer: true }, { pendingTransfer: true }, { transactionType: 'internal_transfer' },
    { legs: [] }, { legs: [{ ...record.legs[0], accountType: 'LIABILITY', amount: '12.35' }] },
  ])('does not search possible account movements: %j', async changes => {
    mocks.records.mockResolvedValue([{ ...record, ...changes }]);
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status: 'skipped_private', query: null, sources: [] });
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it('does not research a different or missing returned transaction', async () => {
    mocks.records.mockResolvedValue([{ ...record, journalId: 43 }]);
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status: 'not_found', journalId: 42 });
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it('can select a short card merchant descriptor after fixed bank wrappers are removed', async () => {
    mocks.records.mockResolvedValue([{ ...record, merchantName: null, description: 'CARD PAYMENT TO EXAMPLE CAFE ON 01/10/2026' }]);
    await executeTool('research_merchant', { journal_id: 42 });
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith({
      merchantName: 'EXAMPLE CAFE', transactionType: 'card_payment', privateNames: ['Private Owner'],
    });
  });

  it.each([
    { merchantName: null }, { merchantName: 'Private Owner' }, { merchantName: 'IBAN GB1234567890123456' },
    { merchantName: null, transactionType: null, description: 'Private Owner 12345678' },
  ])('keeps private or unavailable merchant identifiers off public search: %j', async changes => {
    mocks.records.mockResolvedValue([{ ...record, ...changes }]);
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status: 'skipped_private', query: null, sources: [] });
    expect(mocks.research).not.toHaveBeenCalled();
  });

  it.each(['unavailable', 'no_matches', 'timed_out', 'skipped_private'])('preserves an explicit %s result without inventing sources', async status => {
    mocks.research.mockResolvedValue({ ...result, status, sources: [] });
    expect(await executeTool('research_merchant', { journal_id: 42 })).toMatchObject({ status, sources: [] });
  });

  it('fails privately if source records or research fail, without claiming a match', async () => {
    mocks.research.mockRejectedValue(new Error('private account 12345678 key secret'));
    const response = await executeTool('research_merchant', { journal_id: 42 });
    expect(response).toMatchObject({ status: 'unavailable', sources: [] });
    expect(JSON.stringify(response)).not.toMatch(/12345678|key secret/);
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('advertises only the ID-scoped schema', () => {
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === 'research_merchant')!;
    expect(definition.input_schema).toEqual({
      type: 'object', properties: { journal_id: expect.any(Object) }, required: ['journal_id'], additionalProperties: false,
    });
  });
});
