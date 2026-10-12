import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ connection: vi.fn(), accounts: vi.fn(), start: vi.fn(), finish: vi.fn(), mark: vi.fn(), sync: vi.fn(), reconcile: vi.fn(), process: vi.fn() }));
vi.mock('@/lib/banking/repo', () => ({ bankingRepo: {
  getConnection: mocks.connection, listProviderAccounts: mocks.accounts, startSyncRun: mocks.start,
  finishSyncRun: mocks.finish, markSynced: mocks.mark,
} }));
vi.mock('@/lib/banking/sync', () => ({ syncConnection: mocks.sync, reconcileTransfersForRun: mocks.reconcile }));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
vi.mock('@/lib/banking/gocardless', () => ({
  GoCardlessApiError: class extends Error {},
  GoCardlessAuthError: class extends Error {},
  GoCardlessRateLimitError: class extends Error {},
}));

import { POST } from './route';

const trigger = () => POST(new Request('http://localhost/api/banking/connections/1/sync', { method: 'POST' }), { params: Promise.resolve({ id: '1' }) });
beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue({ id: 1, status: 'active' });
  mocks.accounts.mockResolvedValue([{ accountId: 7 }]);
  mocks.start.mockResolvedValue(12);
  mocks.sync.mockResolvedValue({ txnsAdded: 2, txnsUpdated: 0, journalIds: [100, 101] });
  mocks.reconcile.mockResolvedValue(1);
  mocks.process.mockResolvedValue({ status: 'partial', total: 1, remaining: 20, needsReview: 2, available: 18, batches: 1 });
});

describe('manual bank sync optional processing', () => {
  it('awaits a scoped processing pass only after successful transfer reconciliation', async () => {
    const response = await trigger();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ syncRunId: 12, transfersMerged: 1, txnsAdded: 2, txnsUpdated: 0, categorization: { total: 1, reviewUrl: '/data' } });
    expect(mocks.process).toHaveBeenCalledWith({ journalIds: [100, 101], source: 'bank-sync', limit: 50, modelTimeoutMs: 10_000, deadlineMs: 15_000 });
    expect(mocks.process.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.reconcile.mock.invocationCallOrder[0]);
  });

  it('does not report saved bank transactions as failed if processing throws', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.process.mockRejectedValue(new Error('Processing failed'));
    const response = await trigger();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ txnsAdded: 2, categorization: { status: 'unavailable', remaining: null } });
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][1]).toEqual({ status: 'success', txnsAdded: 2, txnsUpdated: 0 });
  });

  it('keeps a completed sync successful if its timestamp write fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    mocks.mark.mockRejectedValue(new Error('Timestamp storage failed'));
    const response = await trigger();
    expect(response.status).toBe(200);
    expect((await response.json()).txnsAdded).toBe(2);
    expect(mocks.finish).toHaveBeenCalledTimes(1);
    expect(mocks.finish.mock.calls[0][1].status).toBe('success');
  });

  it('defers categories if transfer reconciliation fails without discarding saved counts', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.reconcile.mockRejectedValue(new Error('Sweep failed'));
    const response = await trigger();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ txnsAdded: 2, categorization: { aiSkippedReason: 'transfer_reconciliation_failed' } });
    expect(mocks.process).not.toHaveBeenCalled();
  });
});
