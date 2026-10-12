import { beforeEach, describe, expect, it, vi } from 'vitest';

const processCategorization = vi.hoisted(() => vi.fn());
vi.mock('@/lib/categorization/service', () => ({ processCategorization }));

import { deferredCategorization, processSavedTransactions } from './processing-hook';

beforeEach(() => { processCategorization.mockReset(); });

describe('optional processing of saved transactions', () => {
  it('returns the engine outcome and review link without changing counts', async () => {
    processCategorization.mockResolvedValue({
      status: 'partial', total: 4, ruleBased: 1, learned: 1, aiCategorized: 1,
      aiNoMatch: 1, reviewQueued: 1, conflicts: 0, remaining: 20,
      needsReview: 2, available: 18, hasMore: true, aiSkippedReason: null,
      batches: 1, busy: false,
    });
    const options = { journalIds: [7, 8], source: 'import' as const, limit: 50, modelTimeoutMs: 10_000, deadlineMs: 15_000 };
    const result = await processSavedTransactions(options);
    expect(processCategorization).toHaveBeenCalledWith(options);
    expect(result).toMatchObject({ status: 'partial', total: 4, remaining: 20, reviewUrl: '/data' });
  });

  it('awaits the whole processing pass rather than discarding serverless work', async () => {
    let release!: (value: { status: 'complete' }) => void;
    processCategorization.mockReturnValue(new Promise(resolve => { release = resolve; }));
    const settled = vi.fn();
    const pending = processSavedTransactions({ source: 'import' }).then(settled);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    release({ status: 'complete' });
    await pending;
    expect(settled).toHaveBeenCalledOnce();
  });

  it('does not turn a saved import into a failure or invent an empty backlog', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    processCategorization.mockRejectedValue(new Error('Private merchant description and provider body'));
    const result = await processSavedTransactions({ source: 'import' });
    expect(result).toMatchObject({
      status: 'unavailable', remaining: null, available: null, needsReview: null,
      hasMore: null, aiSkippedReason: 'processing_failed', reviewUrl: '/data',
      total: null, ruleBased: null, learned: null, aiCategorized: null,
      reviewQueued: null, batches: null, conflicts: null,
    });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('Private');
    warning.mockRestore();
  });

  it('explains a deferred processing pass without claiming success', () => {
    expect(deferredCategorization('transfer_reconciliation_failed')).toMatchObject({
      status: 'unavailable', total: 0, remaining: null,
      aiSkippedReason: 'transfer_reconciliation_failed', reviewUrl: '/data',
    });
  });
});
