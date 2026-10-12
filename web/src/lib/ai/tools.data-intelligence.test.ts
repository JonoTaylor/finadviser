import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  process: vi.fn(), intelligence: vi.fn(), records: vi.fn(), confirm: vi.fn(),
  categories: vi.fn(), entries: vi.fn(), uncategorized: vi.fn(), month: vi.fn(),
  legacyUpdate: vi.fn(), legacyBulkUpdate: vi.fn(), addRule: vi.fn(),
  category: vi.fn(), categoryByName: vi.fn(), createCategory: vi.fn(),
}));
vi.mock('@/lib/repos', () => ({
  accountRepo: {}, propertyRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {}, aiMemoryRepo: {}, ownerTaxRepo: {},
  journalRepo: {
    listEntries: mocks.entries, listUncategorizedWithAmounts: mocks.uncategorized,
    listUncategorizedInMonth: mocks.month, updateCategory: mocks.legacyUpdate, updateCategoryBulk: mocks.legacyBulkUpdate,
  },
  categoryRepo: { listAll: mocks.categories, addRule: mocks.addRule, getById: mocks.category, getByName: mocks.categoryByName, create: mocks.createCategory },
}));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
vi.mock('@/lib/data-intelligence/load', () => ({ loadDataIntelligence: mocks.intelligence }));
vi.mock('@/lib/categorization/review', () => ({
  getCategorizationRecords: mocks.records, confirmedCategorize: mocks.confirm,
  CategorizationConflictError: class CategorizationConflictError extends Error {},
  InvalidCategorizationError: class InvalidCategorizationError extends Error {},
}));

import { CategorizationConflictError, InvalidCategorizationError } from '@/lib/categorization/review';
import { executeTool, TOOL_DEFINITIONS } from './tools';

const snapshot = '1234567890abcdef1234567890abcdef';
const mapping = { journal_id: 42, category_id: 8, expected_snapshot: snapshot };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.categories.mockResolvedValue([{ id: 8, name: 'Groceries' }, { id: 9, name: 'Transport' }]);
  mocks.confirm.mockImplementation(async ({ journalId, categoryId, remember }) => ({ journalId, categoryId, remembered: remember === true }));
  mocks.category.mockResolvedValue({ id: 8, name: 'Groceries' });
  mocks.addRule.mockImplementation(async data => ({ id: 7, ...data }));
  mocks.entries.mockResolvedValue([]);
  mocks.uncategorized.mockResolvedValue([]);
  mocks.month.mockResolvedValue([]);
});

function expectNoCategoryWrites() {
  expect(mocks.confirm).not.toHaveBeenCalled();
  expect(mocks.legacyUpdate).not.toHaveBeenCalled();
  expect(mocks.legacyBulkUpdate).not.toHaveBeenCalled();
  expect(mocks.addRule).not.toHaveBeenCalled();
}

describe('AI data-processing tools', () => {
  it('uses the shared bounded processor and preserves honest review, conflict and model status', async () => {
    const result = {
      status: 'partial', total: 100, ruleBased: 12, aiCategorized: 20, learned: 4,
      remaining: 93, needsReview: 22, available: 71, reviewQueued: 8, conflicts: 1,
      hasMore: true, aiSkippedReason: 'Model timeout', reviewUrl: '/data',
    };
    mocks.process.mockResolvedValue(result);
    expect(await executeTool('auto_categorize', {})).toEqual(result);
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith({ source: 'manual', limit: 100 });
    expectNoCategoryWrites();
  });

  it('only processes the explicitly selected journal IDs when provided', async () => {
    await executeTool('auto_categorize', { limit: 2, journal_ids: [42, 43] });
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith({ source: 'manual', limit: 2, journalIds: [42, 43] });
  });

  it('does not manufacture zero remaining work or expose database errors when a processing pass fails', async () => {
    mocks.process.mockRejectedValue(new Error('postgres://private-ledger sensitive merchant'));
    const result = await executeTool('auto_categorize', {});
    expect(result).toMatchObject({ status: 'unavailable', total: null, remaining: null, needsReview: null, available: null, hasMore: null });
    expect(JSON.stringify(result)).not.toContain('private-ledger');
    expect(JSON.stringify(result)).not.toContain('sensitive merchant');
    expectNoCategoryWrites();
  });

  it.each([
    { limit: 0 }, { limit: 101 }, { limit: 1.5 }, { limit: '100' }, { limit: Infinity },
    { journal_ids: [] }, { journal_ids: [42, 42] }, { journal_ids: [-1] },
    { journal_ids: [1.5] }, { journal_ids: Array.from({ length: 101 }, (_, i) => i + 1) },
    { confidence: 0 }, { source: 'user' }, { create_rules: true },
  ])('rejects invalid or policy-changing processing input without reads or writes: %j', async input => {
    expect(await executeTool('auto_categorize', input)).toHaveProperty('error');
    expect(mocks.process).not.toHaveBeenCalled();
    expectNoCategoryWrites();
  });

  it('keeps unknown data coverage and unavailable sources unchanged', async () => {
    const report = {
      status: 'partial', scope: 'household', asOf: '2026-10-12',
      transactions: { totalCount: null, uncategorisedCount: null, reviewNeededCount: null, status: 'unavailable' },
      gaps: [{ domain: 'pensions', title: 'Add a pension statement', action: { href: '/pension-records', kind: 'upload' } }],
    };
    mocks.intelligence.mockResolvedValue(report);
    expect(await executeTool('get_data_intelligence', {})).toEqual(report);
    expect(mocks.intelligence).toHaveBeenCalledExactlyOnceWith();
    expectNoCategoryWrites();
  });

  it('rejects fields on the read-only intelligence tool rather than accepting a write instruction', async () => {
    expect(await executeTool('get_data_intelligence', { process: true })).toHaveProperty('error');
    expect(mocks.intelligence).not.toHaveBeenCalled();
    expectNoCategoryWrites();
  });
});

describe('AI user-confirmed categorisation guards', () => {
  it.each([
    { journal_id: 0 }, { journal_id: 1.5 }, { category_id: -1 }, { category_id: '8' },
    { expected_snapshot: undefined }, { expected_snapshot: '' }, { expected_snapshot: 'outdated' },
    { remember: 'true' }, { property_id: 2 }, { is_transfer: false },
  ])('rejects malformed or unsupported single edits before writing: %j', async invalid => {
    expect(await executeTool('categorize_transaction', { ...mapping, ...invalid })).toHaveProperty('error');
    expectNoCategoryWrites();
  });

  it('passes the exact user-reviewed snapshot to the atomic writer without learning a broad rule', async () => {
    expect(await executeTool('categorize_transaction', mapping)).toEqual({ success: true, journalId: 42, categoryId: 8, remembered: false });
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({ journalId: 42, categoryId: 8, snapshot, remember: false });
    expect(mocks.legacyUpdate).not.toHaveBeenCalled();
    expect(mocks.addRule).not.toHaveBeenCalled();
  });

  it('reports a changed transaction as a conflict and never replays a stale correction', async () => {
    mocks.confirm.mockRejectedValue(new CategorizationConflictError());
    expect(await executeTool('categorize_transaction', mapping)).toMatchObject({ success: false, status: 'conflict', journalId: 42 });
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(mocks.legacyUpdate).not.toHaveBeenCalled();
  });

  it('learns an exact transaction context only through the explicitly requested remember option', async () => {
    expect(await executeTool('categorize_transaction', { ...mapping, remember: true })).toMatchObject({ success: true, remembered: true });
    expect(mocks.confirm).toHaveBeenCalledExactlyOnceWith({ journalId: 42, categoryId: 8, snapshot, remember: true });
    expect(mocks.addRule).not.toHaveBeenCalled();
  });

  it('retains a transfer or unknown-category rejection from the shared writer', async () => {
    mocks.confirm.mockRejectedValue(new InvalidCategorizationError('Transfer entries cannot be categorised.'));
    expect(await executeTool('categorize_transaction', mapping)).toMatchObject({ success: false, status: 'rejected', error: 'Transfer entries cannot be categorised.' });
  });

  it('does not expose database or financial details from failed saves', async () => {
    mocks.confirm.mockRejectedValue(new Error('postgres://private-ledger secret transaction'));
    const result = await executeTool('categorize_transaction', mapping);
    expect(result).toMatchObject({ success: false, status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('private-ledger');
    expect(JSON.stringify(result)).not.toContain('secret transaction');
  });

  it.each([
    { items: [] }, { items: [mapping, mapping] },
    { items: [mapping, { journal_id: 43, category_id: 9 }] },
    { items: Array.from({ length: 101 }, (_, i) => ({ ...mapping, journal_id: i + 1 })) },
    { items: [mapping], approve_all: true },
  ])('validates the entire bulk request before any reads or writes: %j', async input => {
    expect(await executeTool('apply_categorizations_bulk', input)).toHaveProperty('error');
    expect(mocks.categories).not.toHaveBeenCalled();
    expectNoCategoryWrites();
  });

  it('rejects all mappings when any category ID does not exist', async () => {
    expect(await executeTool('apply_categorizations_bulk', { items: [mapping, { ...mapping, journal_id: 43, category_id: 999 }] })).toHaveProperty('error');
    expectNoCategoryWrites();
  });

  it('reports exactly which bulk corrections applied and which conflicted or were rejected', async () => {
    mocks.confirm.mockResolvedValueOnce({ journalId: 42, categoryId: 8, remembered: false })
      .mockRejectedValueOnce(new CategorizationConflictError())
      .mockRejectedValueOnce(new InvalidCategorizationError('Pending transfer review.'));
    const result = await executeTool('apply_categorizations_bulk', { items: [mapping, { ...mapping, journal_id: 43 }, { ...mapping, journal_id: 44 }] });
    expect(result).toMatchObject({ status: 'partial', requested: 3, applied: 1, conflicts: 1, rejected: 1, unavailable: 0 });
    expect(result).toHaveProperty('results', [
      { journalId: 42, categoryId: 8, status: 'applied' },
      expect.objectContaining({ journalId: 43, status: 'conflict' }),
      expect.objectContaining({ journalId: 44, status: 'rejected' }),
    ]);
    expect(mocks.legacyBulkUpdate).not.toHaveBeenCalled();
  });

  it('stops writes after an unavailable save while preserving the accurate partial result', async () => {
    mocks.confirm.mockResolvedValueOnce({ journalId: 42, categoryId: 8, remembered: false })
      .mockRejectedValueOnce(new Error('database outage'));
    expect(await executeTool('apply_categorizations_bulk', { items: [mapping, { ...mapping, journal_id: 43 }, { ...mapping, journal_id: 44 }] }))
      .toMatchObject({ status: 'partial', applied: 1, requested: 3, unavailable: 2 });
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });

  it('makes no writes when category validation is unavailable', async () => {
    mocks.categories.mockRejectedValue(new Error('DB password'));
    const result = await executeTool('apply_categorizations_bulk', { items: [mapping] });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(JSON.stringify(result)).not.toContain('DB password');
    expectNoCategoryWrites();
  });
});

describe('AI explicitly approved category rules', () => {
  it.each([
    { match_type: 'contains' }, { match_type: 'startswith' }, { match_type: 'regex' },
    { pattern: '' }, { pattern: '   ' }, { pattern: 'x'.repeat(201) },
    { category_id: 1.5 }, { category_id: 0 }, { category_id: '8' },
    { source: 'ai' }, { priority: 99 },
  ])('rejects broad, malformed or policy-changing rules before reading or creating: %j', async invalid => {
    expect(await executeTool('add_categorization_rule', { pattern: 'TESCO', category_id: 8, ...invalid })).toHaveProperty('error');
    expect(mocks.category).not.toHaveBeenCalled();
    expectNoCategoryWrites();
  });

  it('creates an approved exact rule as a user rule the shared engine can actually apply', async () => {
    expect(await executeTool('add_categorization_rule', { pattern: ' TESCO ', category_id: 8 }))
      .toMatchObject({ id: 7, pattern: 'TESCO', categoryId: 8, matchType: 'exact' });
    expect(mocks.category).toHaveBeenCalledExactlyOnceWith(8);
    expect(mocks.addRule).toHaveBeenCalledExactlyOnceWith({ pattern: 'TESCO', categoryId: 8, matchType: 'exact', source: 'user' });
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('rejects an unknown category without saving a rule', async () => {
    mocks.category.mockResolvedValue(null);
    expect(await executeTool('add_categorization_rule', { pattern: 'TESCO', category_id: 999 })).toHaveProperty('error');
    expectNoCategoryWrites();
  });

  it.each([{ name: '' }, { name: '   ' }, { name: 'x'.repeat(121) }, { name: 3 }, { name: 'Savings', parent_id: 7 }])('does not invent malformed categories: %j', async input => {
    expect(await executeTool('create_category', input)).toHaveProperty('error');
    expect(mocks.categoryByName).not.toHaveBeenCalled();
    expect(mocks.createCategory).not.toHaveBeenCalled();
  });
});

describe('AI current categorisation context', () => {
  it('returns signed ledger context, current categories and missing IDs without losing transfer flags', async () => {
    const legs = [{ accountId: 1, accountName: 'Bank', amount: '-20.00', accountType: 'ASSET', ownerId: null }];
    mocks.records.mockResolvedValue([{ journalId: 42, date: '2026-10-01', description: 'Merchant', merchantName: null, legs, categoryId: 8, snapshot, isTransfer: false, pendingTransfer: true }]);
    expect(await executeTool('get_transaction_categorization', { journal_ids: [42, 43] })).toMatchObject({
      status: 'ready', requested: 2, missingJournalIds: [43],
      records: [{ journalId: 42, categoryId: 8, snapshot, isTransfer: false, pendingTransfer: true, legs }],
    });
    expectNoCategoryWrites();
  });

  it('bounds reference text and long ledger lists while disclosing that the fingerprint covers all context', async () => {
    mocks.records.mockResolvedValue([{ journalId: 42, description: 'x'.repeat(700), merchantName: 'm'.repeat(300), legs: Array.from({ length: 25 }, (_, i) => ({ accountId: i + 1 })), snapshot }]);
    const result = await executeTool('get_transaction_categorization', { journal_ids: [42] }) as { records: Array<{ description: string; merchantName: string; legs: unknown[]; legCount: number; legsTruncated: boolean; referenceTextTruncated: boolean; snapshot: string }> };
    expect(result.records[0]).toMatchObject({ snapshot, legCount: 25, legsTruncated: true, referenceTextTruncated: true });
    expect(result.records[0].description).toHaveLength(500);
    expect(result.records[0].merchantName).toHaveLength(160);
    expect(result.records[0].legs).toHaveLength(20);
  });

  it.each([{ journal_ids: [] }, { journal_ids: [42, 42] }, { journal_ids: ['42'] }, { journal_ids: [42], category_id: 8 }])('rejects malformed context requests: %j', async input => {
    expect(await executeTool('get_transaction_categorization', input)).toHaveProperty('error');
    expect(mocks.records).not.toHaveBeenCalled();
  });

  it('shows failed reads as unavailable and does not manufacture an empty healthy transaction list', async () => {
    mocks.records.mockRejectedValue(new Error('DB private-ledger'));
    const result = await executeTool('get_transaction_categorization', { journal_ids: [42] });
    expect(result).toMatchObject({ status: 'unavailable' });
    expect(result).not.toHaveProperty('records');
    expect(JSON.stringify(result)).not.toContain('private-ledger');
  });

  it.each([
    ['list_uncategorized', { limit: -1 }], ['list_uncategorized', { limit: 1000 }],
    ['list_uncategorized_in_month', { month: '2026-13' }],
    ['list_uncategorized_in_month', { month: '2026-10', limit: 2.5 }],
    ['search_transactions', { limit: Infinity }],
    ['search_transactions', { start_date: '2026-02-30' }],
    ['search_transactions', { start_date: '2026-10-12', end_date: '2026-10-01' }],
  ])('rejects invalid read scope rather than issuing an unbounded or invalid query: %s %j', async (tool, input) => {
    expect(await executeTool(tool as string, input as Record<string, unknown>)).toHaveProperty('error');
    expect(mocks.entries).not.toHaveBeenCalled();
    expect(mocks.uncategorized).not.toHaveBeenCalled();
    expect(mocks.month).not.toHaveBeenCalled();
  });

  it('requires snapshots and forbids extra fields in the provider schemas as well as at execution', () => {
    for (const name of ['auto_categorize', 'get_data_intelligence', 'get_transaction_categorization', 'categorize_transaction', 'apply_categorizations_bulk']) {
      expect(TOOL_DEFINITIONS.find(tool => tool.name === name)?.input_schema.additionalProperties).toBe(false);
    }
    expect(TOOL_DEFINITIONS.find(tool => tool.name === 'categorize_transaction')?.input_schema.required).toContain('expected_snapshot');
  });
});
