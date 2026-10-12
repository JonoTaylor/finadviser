import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  listConnections: vi.fn(), setStatus: vi.fn(), listAccounts: vi.fn(), start: vi.fn(),
  finish: vi.fn(), markSynced: vi.fn(), dismiss: vi.fn(), upsert: vi.fn(),
  sync: vi.fn(), reconcile: vi.fn(), process: vi.fn(),
}));
vi.mock('./repo', () => ({ bankingRepo: {
  listConnections: mocks.listConnections, setConnectionStatus: mocks.setStatus,
  listProviderAccounts: mocks.listAccounts, startSyncRun: mocks.start,
  finishSyncRun: mocks.finish, markSynced: mocks.markSynced,
} }));
vi.mock('./sync', () => ({ syncConnection: mocks.sync, reconcileTransfersForRun: mocks.reconcile }));
vi.mock('@/lib/repos', () => ({ tipRepo: { dismissByTag: mocks.dismiss, upsertTagged: mocks.upsert } }));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));

import { runDailySync } from './cron-sync';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.listConnections.mockResolvedValue([{ id: 1, status: 'active', consentExpiresAt: null, providerDisplayName: 'Bank' }]);
  mocks.listAccounts.mockResolvedValue([{ accountId: 7 }]);
  mocks.start.mockResolvedValue(12);
  mocks.sync.mockResolvedValue({ txnsAdded: 2, txnsUpdated: 0, journalIds: [100, 101] });
  mocks.reconcile.mockResolvedValue(1);
  mocks.process.mockResolvedValue({ status: 'partial', total: 1, remaining: 20, needsReview: 2, available: 18, batches: 1 });
});

describe('daily bank sync and processing backlog', () => {
  it('processes the global backlog after cross-bank reconciliation and finished sync bookkeeping', async () => {
    const summary = await runDailySync();
    expect(summary).toMatchObject({ synced: 1, transfersMerged: 1, errors: [], categorization: { total: 1, reviewUrl: '/data' } });
    expect(mocks.finish).toHaveBeenCalledWith(12, { status: 'success', txnsAdded: 2, txnsUpdated: 0 });
    expect(mocks.process).toHaveBeenCalledWith({ source: 'scheduled', limit: 50, modelTimeoutMs: 8_000, deadlineMs: 12_000 });
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.reconcile.mock.invocationCallOrder[0]);
    expect(mocks.reconcile.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.finish.mock.invocationCallOrder[0]);
  });

  it('continues processing older imports on a day with no connected banks', async () => {
    mocks.listConnections.mockResolvedValue([]);
    const summary = await runDailySync();
    expect(summary).toMatchObject({ synced: 0, total: 0, categorization: { total: 1 } });
    expect(mocks.process).toHaveBeenCalledWith(expect.objectContaining({ source: 'scheduled' }));
    expect(mocks.process.mock.calls[0][0].journalIds).toBeUndefined();
  });

  it('keeps successful bank counts if optional processing fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.process.mockRejectedValue(new Error('Processing storage unavailable'));
    const summary = await runDailySync();
    expect(summary).toMatchObject({ synced: 1, errors: [], categorization: { status: 'unavailable', remaining: null } });
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][1].status).toBe('success');
  });

  it('defers categorisation after a failed transfer sweep', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.reconcile.mockRejectedValue(new Error('Sweep unavailable'));
    const summary = await runDailySync();
    expect(summary).toMatchObject({ synced: 1, categorization: { aiSkippedReason: 'transfer_reconciliation_failed' } });
    expect(mocks.process).not.toHaveBeenCalled();
  });

  it('returns a deferred outcome when bank sync consumed the cron time budget', async () => {
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(54_500);
    const summary = await runDailySync();
    expect(summary).toMatchObject({ synced: 1, categorization: { aiSkippedReason: 'time_budget_exhausted', remaining: null } });
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
