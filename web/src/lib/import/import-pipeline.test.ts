import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RawTransaction } from '@/lib/types';

const mocks = vi.hoisted(() => ({
  parseCSV: vi.fn(), checkDuplicates: vi.fn(), categorizeTransactions: vi.fn(),
  getByName: vi.fn(), getOrCreate: vi.fn(), createEntriesBulk: vi.fn(),
  fingerprints: vi.fn(), createBatch: vi.fn(), updateCounts: vi.fn(),
  metadata: vi.fn(), process: vi.fn(), reconcile: vi.fn(),
}));
vi.mock('./csv-parser', () => ({ parseCSV: mocks.parseCSV }));
vi.mock('./duplicate-detector', () => ({ checkDuplicates: mocks.checkDuplicates }));
vi.mock('./categorizer', () => ({ categorizeTransactions: mocks.categorizeTransactions }));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
vi.mock('@/lib/banking/sync', () => ({ reconcileTransfersForRun: mocks.reconcile }));
vi.mock('@/lib/repos', () => ({
  accountRepo: { getByName: mocks.getByName, getOrCreate: mocks.getOrCreate },
  journalRepo: { createEntriesBulk: mocks.createEntriesBulk },
  fingerprintRepo: { createMany: mocks.fingerprints },
  importBatchRepo: { create: mocks.createBatch, updateCounts: mocks.updateCounts },
  transactionMetadataRepo: { createMany: mocks.metadata },
}));

import { executeImport, executeImportFromParsed, previewImport } from './import-pipeline';

const transaction = (patch: Partial<RawTransaction> = {}): RawTransaction => ({
  date: '2026-10-12', description: 'Grocer', amount: '-50.10',
  reference: 'card', fingerprint: 'a', isDuplicate: false, suggestedCategoryId: null,
  ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.checkDuplicates.mockImplementation(async rows => rows);
  mocks.categorizeTransactions.mockImplementation(async rows => rows);
  mocks.getByName.mockResolvedValue({ id: 7 });
  mocks.getOrCreate.mockImplementation(async name => ({ id: name === 'Uncategorized Income' ? 8 : name === 'Uncategorized Expense' ? 9 : 7 }));
  mocks.createBatch.mockResolvedValue({ id: 12 });
  mocks.reconcile.mockResolvedValue(0);
  let nextId = 100;
  mocks.createEntriesBulk.mockImplementation(async rows => rows.map(() => nextId++));
  mocks.process.mockResolvedValue({
    status: 'partial', total: 2, ruleBased: 1, learned: 0, aiCategorized: 0,
    aiNoMatch: 1, remaining: 1, needsReview: 1, available: 0,
    reviewQueued: 1, conflicts: 0, hasMore: false, aiSkippedReason: null,
    batches: 1, busy: false,
  });
});

afterEach(() => { vi.restoreAllMocks(); });

describe('saved imports and bounded automatic categorisation', () => {
  it('preserves balanced book entries, duplicates, fingerprints and metadata before processing', async () => {
    const rows = [
      transaction({ suggestedCategoryId: 88, metadata: { merchantName: 'Grocer', externalId: 'bank-1' } }),
      transaction({ amount: '2500.00', description: 'Pay', fingerprint: 'b' }),
      transaction({ isDuplicate: true, suggestedCategoryId: 77, fingerprint: 'c' }),
    ];
    const progress = vi.fn();
    const categorising = vi.fn();
    const result = await executeImportFromParsed(rows, 'Monzo', progress, categorising);
    expect(result).toMatchObject({ batchId: 12, importedCount: 2, duplicateCount: 1, totalCount: 3 });
    expect(mocks.createEntriesBulk).toHaveBeenCalledWith([
      { journal: { date: '2026-10-12', description: 'Grocer', reference: 'card', categoryId: null, importBatchId: 12 },
        entries: [{ accountId: 7, amount: '-50.1' }, { accountId: 9, amount: '50.1' }] },
      { journal: { date: '2026-10-12', description: 'Pay', reference: 'card', categoryId: null, importBatchId: 12 },
        entries: [{ accountId: 7, amount: '2500' }, { accountId: 8, amount: '-2500' }] },
    ]);
    expect(mocks.fingerprints).toHaveBeenCalledWith([
      { fingerprint: 'a', accountId: 7, journalEntryId: 100 },
      { fingerprint: 'b', accountId: 7, journalEntryId: 101 },
    ]);
    expect(mocks.metadata.mock.calls[0][0]).toMatchObject([{ journalEntryId: 100, merchantName: 'Grocer', externalId: 'bank-1' }]);
    expect(mocks.updateCounts).toHaveBeenCalledWith(12, 2, 1);
    expect(mocks.process).toHaveBeenCalledWith({ journalIds: [100, 101], source: 'import', limit: 50, modelTimeoutMs: 10_000, deadlineMs: 15_000 });
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.updateCounts.mock.invocationCallOrder[0]);
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.reconcile.mock.invocationCallOrder[0]);
    expect(progress.mock.calls).toEqual([[0, 2], [2, 2]]);
    expect(categorising).toHaveBeenCalledWith(2);
    expect(result.categorization).toMatchObject({ reviewUrl: '/data', preclassifiedCount: 0 });
    expect(rows[2].suggestedCategoryId).toBe(77);
  });

  it('keeps preview hints separate from confirmed and audited categories', async () => {
    mocks.parseCSV.mockResolvedValue([transaction({ suggestedCategoryId: 5 })]);
    await previewImport('csv', 'generic-csv', 'Monzo');
    expect(mocks.categorizeTransactions).toHaveBeenCalledOnce();
    mocks.categorizeTransactions.mockClear();
    await executeImport('csv', 'generic-csv', 'Monzo');
    expect(mocks.categorizeTransactions).not.toHaveBeenCalled();
    expect(mocks.createEntriesBulk.mock.calls[0][0][0].journal.categoryId).toBeNull();
  });

  it('returns successful import counts if optional AI or processing storage fails', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.process.mockRejectedValue(new Error('Processing unavailable'));
    const result = await executeImportFromParsed([transaction()], 'Monzo');
    expect(result).toMatchObject({ importedCount: 1, duplicateCount: 0, totalCount: 1,
      categorization: { status: 'unavailable', remaining: null, reviewUrl: '/data' } });
    expect(mocks.updateCounts).toHaveBeenCalledWith(12, 1, 0);
    warning.mockRestore();
  });

  it('processes only newly inserted IDs on a retry containing duplicates', async () => {
    await executeImportFromParsed([transaction({ isDuplicate: true, suggestedCategoryId: 55 })], 'Monzo');
    expect(mocks.createEntriesBulk).not.toHaveBeenCalled();
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ journalIds: [] }));
    expect(mocks.updateCounts).toHaveBeenCalledWith(12, 0, 1);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it('defers classification if transfer reconciliation fails after saving', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.reconcile.mockRejectedValue(new Error('Reconciliation unavailable'));
    const result = await executeImportFromParsed([transaction()], 'Monzo');
    expect(result).toMatchObject({ importedCount: 1, categorization: { status: 'unavailable', aiSkippedReason: 'transfer_reconciliation_failed' } });
    expect(mocks.process).not.toHaveBeenCalled();
    expect(mocks.updateCounts).toHaveBeenCalledWith(12, 1, 0);
    warning.mockRestore();
  });

  it('caps the processing scope while saving all rows in a large import', async () => {
    const rows = Array.from({ length: 2_101 }, (_, i) => transaction({ fingerprint: `row-${i}` }));
    const result = await executeImportFromParsed(rows, 'Monzo');
    expect(result.importedCount).toBe(2_101);
    expect(mocks.createEntriesBulk).toHaveBeenCalledTimes(22);
    expect(mocks.process.mock.calls[0][0].journalIds).toHaveLength(2_000);
    expect(mocks.process.mock.calls[0][0].limit).toBe(50);
  });

  it('returns saved counts and an honest deferral if saving used the import time budget', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(290_000);
    const result = await executeImportFromParsed([transaction()], 'Monzo');
    expect(result).toMatchObject({ importedCount: 1, categorization: { status: 'unavailable', aiSkippedReason: 'time_budget_exhausted' } });
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
