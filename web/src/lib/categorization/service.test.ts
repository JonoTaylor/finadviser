import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationCandidate, CategorizationDecision } from './types';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(), releaseLease: vi.fn(), listCandidates: vi.fn(), counts: vi.fn(), lookupLearned: vi.fn(), persistDecisions: vi.fn(),
  categories: vi.fn(), rules: vi.fn(), model: vi.fn(),
}));
vi.mock('./repository', () => ({ categorizationRepo: mocks }));
vi.mock('@/lib/repos/category.repo', () => ({ categoryRepo: { listAll: mocks.categories, getRules: mocks.rules } }));
vi.mock('@/lib/ai/claude-client', () => ({ categorizeContextBatch: mocks.model }));
import { processCategorization } from './service';
import { categorizationContextKey } from './decisions';

const candidate = (id = 1): CategorizationCandidate => ({
  id, date: '2026-10-01', description: `Example purchase ${id}`, merchantName: 'Example shop', bankCategory: null,
  transactionType: 'Card payment', currency: 'GBP', propertyId: null, snapshot: `hash${id}`,
  legs: [
    { accountId: 11, accountName: 'Example bank', accountType: 'ASSET', ownerId: 1, amount: '-20.00' },
    { accountId: 12, accountName: 'Expense', accountType: 'EXPENSE', ownerId: null, amount: '20.00' },
  ],
});
const counts = { remaining: 0, needsReview: 0, available: 0, dismissed: 0, scopeAvailable: 0 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('AI_GATEWAY_API_KEY', 'test-key');
  mocks.acquireLease.mockResolvedValue(true);
  mocks.releaseLease.mockResolvedValue(undefined);
  mocks.listCandidates.mockResolvedValue([candidate()]);
  mocks.counts.mockResolvedValue(counts);
  mocks.lookupLearned.mockResolvedValue(new Map());
  mocks.categories.mockResolvedValue([{ id: 1, name: 'Groceries' }, { id: 2, name: 'Other' }]);
  mocks.rules.mockResolvedValue([]);
  mocks.persistDecisions.mockImplementation(async (_candidates: CategorizationCandidate[], decisions: CategorizationDecision[]) => decisions.map(({ journalId, status }) => ({ journalId, status })));
  mocks.model.mockImplementation(async (candidates: CategorizationCandidate[]) => ({ decisions: candidates.map(row => ({ journalId: row.id, categoryId: 1, confidence: 0.95, reason: 'Example merchant evidence.' })) }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded leased categorisation passes', () => {
  it('applies valid AI decisions atomically with the current lease token', async () => {
    const result = await processCategorization();
    expect(result).toMatchObject({ total: 1, aiCategorized: 1, reviewQueued: 0, status: 'complete', busy: false, batches: 1, reviewUrl: '/data', deferredReason: null });
    const token = mocks.acquireLease.mock.calls[0][0];
    expect(mocks.persistDecisions.mock.calls[0][2]).toBe(token);
    expect(mocks.releaseLease).toHaveBeenCalledExactlyOnceWith(token);
    expect(mocks.model.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
  });
  it('retains low confidence as a review item and reports global queue counts', async () => {
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: 1, confidence: 0.5, reason: 'Please clarify what was purchased.' }] });
    mocks.counts.mockResolvedValue({ ...counts, remaining: 3, needsReview: 3 });
    expect(await processCategorization()).toMatchObject({ aiCategorized: 0, aiNoMatch: 1, reviewQueued: 1, needsReview: 3, remaining: 3, hasMore: false });
    expect(mocks.persistDecisions.mock.calls[0][1][0].status).toBe('needs_review');
  });
  it('counts only persisted assignments when concurrent state has changed', async () => {
    mocks.persistDecisions.mockResolvedValue([]);
    expect(await processCategorization()).toMatchObject({ aiCategorized: 0, conflicts: 1 });
  });
  it('reuses confirmed exact context before generic categorisation rules', async () => {
    mocks.lookupLearned.mockResolvedValue(new Map([[categorizationContextKey(candidate()), 2]]));
    mocks.rules.mockResolvedValue([{ pattern: 'Example', categoryId: 1, matchType: 'contains', source: 'system' }]);
    expect(await processCategorization()).toMatchObject({ learned: 1, ruleBased: 0, aiCategorized: 0 });
    expect(mocks.persistDecisions.mock.calls[0][1][0]).toMatchObject({ categoryId: 2, source: 'learned' });
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('ignores deleted learned categories and uses the model rather than arbitrary IDs', async () => {
    mocks.lookupLearned.mockResolvedValue(new Map([[categorizationContextKey(candidate()), 999]]));
    expect(await processCategorization()).toMatchObject({ learned: 0, aiCategorized: 1 });
  });
  it('reports a missing model configuration honestly after applying safe deterministic rules', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    mocks.listCandidates.mockResolvedValue([candidate(), candidate(2)]);
    mocks.rules.mockResolvedValue([{ pattern: 'Example purchase 1', categoryId: 1, matchType: 'exact', source: 'user' }]);
    mocks.counts.mockResolvedValue({ ...counts, remaining: 1, available: 1, scopeAvailable: 1 });
    const result = await processCategorization();
    expect(result).toMatchObject({ ruleBased: 1, aiCategorized: 0, hasMore: true, status: 'partial', deferredReason: 'model_unavailable' });
    expect(result.aiSkippedReason).toContain('not configured');
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('leaves an unprocessed backlog retryable when model credentials are unavailable', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    mocks.counts.mockResolvedValue({ ...counts, available: 1, remaining: 1, scopeAvailable: 1 });
    expect(await processCategorization()).toMatchObject({ aiCategorized: 0, reviewQueued: 0, status: 'unavailable', hasMore: true });
    expect(mocks.persistDecisions).not.toHaveBeenCalled();
  });
  it.each(['failure', 'malformed'])('does not apply a %s model batch or expose provider details', async mode => {
    if (mode === 'failure') mocks.model.mockRejectedValue(new Error('Sensitive merchant/account provider body'));
    else mocks.model.mockResolvedValue({ decisions: [{ journalId: 999, categoryId: 1, confidence: 1, reason: 'Wrong ID' }] });
    const result = await processCategorization();
    expect(result).toMatchObject({ aiCategorized: 0, reviewQueued: 0, status: 'unavailable', deferredReason: 'model_failed' });
    expect(result.aiSkippedReason).not.toContain('Sensitive');
    expect(mocks.persistDecisions).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('Sensitive');
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });
  it('does not call the model for an empty surviving scope', async () => {
    mocks.listCandidates.mockResolvedValue([]);
    const result = await processCategorization({ journalIds: [] });
    expect(mocks.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ journalIds: [] }));
    expect(result).toMatchObject({ total: 0, status: 'complete', batches: 0 });
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('bounds one pass to 100 candidates and model calls to batches of 25', async () => {
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 60 }, (_, i) => candidate(i + 1)));
    await processCategorization({ limit: 1000 });
    expect(mocks.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual([25, 25, 10]);
  });
  it('shares one model time budget across batches', async () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 60 }, (_, i) => candidate(i + 1)));
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[]) => {
      clock += 600;
      return { decisions: rows.map(row => ({ journalId: row.id, categoryId: 1, confidence: 0.95, reason: 'Merchant evidence.' })) };
    });
    mocks.counts.mockResolvedValue({ ...counts, available: 10, remaining: 10, scopeAvailable: 10 });
    const result = await processCategorization({ modelTimeoutMs: 1000 });
    expect(result.batches).toBe(2);
    expect(result.aiCategorized).toBe(25);
    expect(result.deferredReason).toBe('time_budget');
    expect(result.aiSkippedReason).toContain('time budget');
    expect(mocks.model).toHaveBeenCalledTimes(2);
  });
  it('returns honest busy counts without reading or mutating candidates', async () => {
    mocks.acquireLease.mockResolvedValue(false);
    mocks.counts.mockResolvedValue({ ...counts, remaining: 23, needsReview: 3, available: 20, scopeAvailable: 20 });
    expect(await processCategorization()).toMatchObject({ busy: true, remaining: 23, needsReview: 3, hasMore: true, status: 'partial', total: 0, deferredReason: 'busy' });
    expect(mocks.listCandidates).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.releaseLease).not.toHaveBeenCalled();
  });
  it('propagates a failed database save and releases the lease rather than claiming model failure', async () => {
    mocks.persistDecisions.mockRejectedValue(new Error('Database unavailable'));
    await expect(processCategorization()).rejects.toThrow('Database unavailable');
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });
  it('validates scope before accessing the database and deduplicates valid IDs', async () => {
    await expect(processCategorization({ journalIds: [1, -1] })).rejects.toThrow('valid journal');
    expect(mocks.acquireLease).not.toHaveBeenCalled();
    await processCategorization({ journalIds: [1, 1], syncRunIds: [2, 2] });
    expect(mocks.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ journalIds: [1], syncRunIds: [2] }));
  });
  it('keeps learned positive-liability movements for review', async () => {
    const movement = candidate();
    movement.legs[0] = { ...movement.legs[0], accountType: 'LIABILITY', amount: '20.00' };
    mocks.listCandidates.mockResolvedValue([movement]);
    mocks.lookupLearned.mockResolvedValue(new Map([[categorizationContextKey(movement), 1]]));
    expect(await processCategorization()).toMatchObject({ learned: 0, reviewQueued: 1 });
    expect(mocks.persistDecisions.mock.calls[0][1][0].status).toBe('needs_review');
  });
  it('reports a missing category catalogue without calling the model', async () => {
    mocks.categories.mockResolvedValue([]);
    expect(await processCategorization()).toMatchObject({ status: 'unavailable', deferredReason: 'no_categories' });
    expect(mocks.model).not.toHaveBeenCalled();
  });
  it('distinguishes a normal model timeout from a provider failure after a successful batch', async () => {
    let clock = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => clock);
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 50 }, (_, i) => candidate(i + 1)));
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[]) => {
      if (rows[0].id > 25) { clock = 2001; throw new Error('Provider abort body should remain private'); }
      clock = 1500;
      return { decisions: rows.map(row => ({ journalId: row.id, categoryId: 1, confidence: 0.95, reason: 'Merchant evidence.' })) };
    });
    mocks.counts.mockResolvedValue({ ...counts, available: 25, remaining: 25, scopeAvailable: 25 });
    expect(await processCategorization({ modelTimeoutMs: 1000 })).toMatchObject({ aiCategorized: 25, deferredReason: 'time_budget', status: 'partial', hasMore: true });
    expect(mocks.persistDecisions).toHaveBeenCalledTimes(1);
  });
  it('applies a newly confirmed mapping to a queued exact-context candidate without another model call', async () => {
    // listCandidates also selects unchanged review rows whose exact context
    // was subsequently confirmed; the repository owns that guarded query.
    mocks.lookupLearned.mockResolvedValue(new Map([[categorizationContextKey(candidate()), 1]]));
    const result = await processCategorization();
    expect(result).toMatchObject({ learned: 1, aiCategorized: 0, status: 'complete' });
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.persistDecisions.mock.calls[0][1][0]).toMatchObject({ source: 'learned', status: 'applied', categoryId: 1 });
  });
});
