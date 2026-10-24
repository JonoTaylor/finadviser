import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationCandidate, CategorizationDecision } from './types';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';

const mocks = vi.hoisted(() => ({
  acquireLease: vi.fn(), releaseLease: vi.fn(), listCandidates: vi.fn(), counts: vi.fn(), lookupLearned: vi.fn(), persistDecisions: vi.fn(),
  categories: vi.fn(), rules: vi.fn(), owners: vi.fn(), model: vi.fn(), research: vi.fn(), researchQuery: vi.fn(),
}));
vi.mock('./repository', () => ({ categorizationRepo: mocks }));
vi.mock('@/lib/repos/category.repo', () => ({ categoryRepo: { listAll: mocks.categories, getRules: mocks.rules } }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listOwners: mocks.owners } }));
vi.mock('@/lib/ai/claude-client', () => ({ categorizeContextBatch: mocks.model }));
vi.mock('@/lib/merchant-research/privacy', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/merchant-research/privacy')>(),
  buildMerchantResearchQuery: mocks.researchQuery,
}));
vi.mock('@/lib/merchant-research/service', () => ({ researchMerchant: mocks.research }));
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
function mockMerchantResearch(query = 'Example shop UK business'): MerchantResearchResult {
  return {
    status: 'matched', query,
    sources: [{ title: 'Example shop', url: 'https://example.com/shop', snippet: 'Example shop is a supermarket.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
    researchedAt: '2026-10-24T12:00:00.000Z', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
  };
}
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
  mocks.owners.mockResolvedValue([]);
  mocks.researchQuery.mockReturnValue(null);
  mocks.research.mockResolvedValue({ status: 'unavailable', sources: [] });
  mocks.persistDecisions.mockImplementation(async (_candidates: CategorizationCandidate[], decisions: CategorizationDecision[]) => decisions.map(({ journalId, status }) => ({ journalId, status })));
  mocks.model.mockImplementation(async (candidates: CategorizationCandidate[]) => ({ decisions: candidates.map(row => ({ journalId: row.id, categoryId: 1, confidence: 0.95, reason: 'Example merchant evidence.' })) }));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('bounded leased categorisation passes', () => {
  it('applies valid AI decisions atomically with the current lease token', async () => {
    const result = await processCategorization();
    expect(result).toMatchObject({ total: 1, aiCategorized: 1, reviewQueued: 0, status: 'complete', busy: false, batches: 1, reviewUrl: '/data', deferredReason: null });
    const token = mocks.acquireLease.mock.calls[0][0];
    expect(mocks.persistDecisions.mock.calls[0][2]).toBe(token);
    expect(mocks.releaseLease).toHaveBeenCalledExactlyOnceWith(token);
    expect(mocks.model.mock.calls[0][2]).toBeInstanceOf(AbortSignal);
    expect(mocks.owners).not.toHaveBeenCalled();
  });
  it('retains low confidence as a review item and reports global queue counts', async () => {
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: 1, confidence: 0.5, reason: 'Please clarify what was purchased.' }] });
    mocks.counts.mockResolvedValue({ ...counts, remaining: 3, needsReview: 3 });
    expect(await processCategorization()).toMatchObject({ aiCategorized: 0, aiNoMatch: 1, reviewQueued: 1, needsReview: 3, remaining: 3, hasMore: false });
    expect(mocks.persistDecisions.mock.calls[0][1][0].status).toBe('needs_review');
  });
  it('researches an ambiguous public merchant and persists cited evidence with the final decision', async () => {
    const evidence = mockMerchantResearch();
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'example-shop' });
    mocks.research.mockResolvedValue(evidence);
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[], _categories, _signal, research?: ReadonlyMap<number, MerchantResearchResult>) => ({
      decisions: rows.map(row => ({ journalId: row.id, categoryId: research?.has(row.id) ? 1 : null, confidence: research?.has(row.id) ? 0.95 : 0.3, reason: research?.has(row.id) ? 'Public merchant source identifies a supermarket.' : 'Merchant identity is uncertain.' })),
    }));
    const result = await processCategorization();
    expect(result).toMatchObject({ aiCategorized: 1, reviewQueued: 0, batches: 2 });
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith(
      { merchantName: 'Example shop', transactionType: 'Card payment', privateNames: [] },
      { signal: expect.any(AbortSignal), timeoutMs: 6_000 },
    );
    expect(mocks.model.mock.calls[1][3].get(1)).toEqual(evidence);
    expect(mocks.persistDecisions.mock.calls[0][1][0]).toMatchObject({ categoryId: 1, evidence });
  });
  it('bounds research to two unique safe public queries and never researches account movements', async () => {
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 10 }, (_, i) => ({ ...candidate(i + 1), merchantName: `Public Shop ${i + 1}` })));
    mocks.researchQuery.mockImplementation((input: { merchantName: string | null }) => ({ merchantName: input.merchantName, coarseLocation: null, query: input.merchantName, cacheKey: input.merchantName }));
    mocks.research.mockImplementation(async (input: { merchantName: string }) => mockMerchantResearch(input.merchantName));
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[], _categories, _signal, research?: ReadonlyMap<number, MerchantResearchResult>) => ({ decisions: rows.map(row => ({ journalId: row.id, categoryId: research?.has(row.id) ? 1 : null, confidence: research?.has(row.id) ? 0.95 : 0.3, reason: 'Merchant identity evidence.' })) }));
    expect(await processCategorization()).toMatchObject({ aiCategorized: 2, reviewQueued: 8 });
    expect(mocks.research).toHaveBeenCalledTimes(2);
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual([5, 2, 5]);

    mocks.research.mockClear();
    mocks.listCandidates.mockResolvedValue([{ ...candidate(), transactionType: 'Internal transfer' }]);
    await processCategorization();
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it('reuses one researched merchant across duplicate contexts without adding public queries', async () => {
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 10 }, (_, i) => candidate(i + 1)));
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'same-public-shop' });
    mocks.research.mockResolvedValue(mockMerchantResearch());
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[], _categories, _signal, research?: ReadonlyMap<number, MerchantResearchResult>) => ({ decisions: rows.map(row => ({ journalId: row.id, categoryId: research?.has(row.id) ? 1 : null, confidence: research?.has(row.id) ? 0.95 : 0.3, reason: 'Merchant identity evidence.' })) }));
    expect(await processCategorization()).toMatchObject({ aiCategorized: 10, reviewQueued: 0 });
    expect(mocks.research).toHaveBeenCalledOnce();
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual([5, 5, 5, 5]);
    expect(mocks.owners).toHaveBeenCalledOnce();
  });
  it('keeps the valid local review when research stalls and does not turn that into a processing failure', async () => {
    vi.useFakeTimers();
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'same-public-shop' });
    mocks.research.mockImplementation(() => new Promise(() => {}));
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.3, reason: 'Please clarify the purchase.' }] });
    const processing = processCategorization();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(await processing).toMatchObject({ reviewQueued: 1, aiCategorized: 0, deferredReason: null, status: 'complete', batches: 1 });
    expect(mocks.persistDecisions.mock.calls[0][1][0]).toMatchObject({ categoryId: null, reason: 'Please clarify the purchase.' });
    expect(mocks.research.mock.calls[0][1].signal.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves the original review if a researched reclassification fails validation', async () => {
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'same-public-shop' });
    mocks.research.mockResolvedValue(mockMerchantResearch());
    mocks.model.mockResolvedValueOnce({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.3, reason: 'Please clarify the purchase.' }] });
    mocks.model.mockResolvedValueOnce({ decisions: [{ journalId: 999, categoryId: 1, confidence: 1, reason: 'Foreign transaction ID.' }] });
    expect(await processCategorization()).toMatchObject({ reviewQueued: 1, aiCategorized: 0 });
    expect(mocks.persistDecisions.mock.calls[0][1][0]).toMatchObject({ journalId: 1, categoryId: null, reason: 'Please clarify the purchase.' });
  });
  it('gives research its own bounded allowance while preserving the shared model time budget', async () => {
    vi.useFakeTimers();
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'same-public-shop' });
    mocks.research.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(mockMerchantResearch()), 5_500)));
    mocks.model.mockImplementation(async (rows: CategorizationCandidate[], _categories, _signal, research?: ReadonlyMap<number, MerchantResearchResult>) => {
      await new Promise(resolve => setTimeout(resolve, 2_000));
      return { decisions: rows.map(row => ({ journalId: row.id, categoryId: research?.has(row.id) ? 1 : null, confidence: research?.has(row.id) ? 0.95 : 0.3, reason: 'Merchant identity evidence.' })) };
    });
    const startedAt = Date.now();
    const processing = processCategorization({ modelTimeoutMs: 5_000, deadlineMs: 15_000 });
    await vi.advanceTimersByTimeAsync(9_500);
    expect(await processing).toMatchObject({ aiCategorized: 1, reviewQueued: 0, deferredReason: null, status: 'complete', batches: 2 });
    expect(Date.now() - startedAt).toBe(9_500);
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('never substitutes private statement text for a missing structured merchant', async () => {
    mocks.listCandidates.mockResolvedValue([{ ...candidate(), merchantName: null, description: 'Jono Taylor account 12345678 private payment reference' }]);
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.2, reason: 'Please clarify the purchase.' }] });
    await processCategorization();
    expect(mocks.researchQuery).not.toHaveBeenCalled();
    expect(mocks.research).not.toHaveBeenCalled();
  });
  it('excludes known owner names locally before a public merchant lookup', async () => {
    mocks.owners.mockResolvedValue([{ id: 1, name: 'Jono Taylor' }, { id: 2, name: 'Emily Pun' }]);
    mocks.listCandidates.mockResolvedValue([{ ...candidate(), merchantName: 'Jono Taylor' }]);
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.2, reason: 'Please clarify the purchase.' }] });
    expect(await processCategorization()).toMatchObject({ reviewQueued: 1, aiCategorized: 0 });
    expect(mocks.owners).toHaveBeenCalledOnce();
    expect(mocks.research).not.toHaveBeenCalled();
    // Local eligibility/category validation may inspect the name; only the
    // public provider boundary must remain untouched for a known owner.
  });
  it('researches a safely cleaned card descriptor when structured merchant metadata is missing', async () => {
    mocks.owners.mockResolvedValue([{ id: 1, name: 'Jono Taylor' }]);
    mocks.listCandidates.mockResolvedValue([{ ...candidate(), merchantName: null, description: 'CARD PAYMENT TO TESCO CARD ENDING 1234 ON 24/10/2026' }]);
    mocks.researchQuery.mockReturnValue({ merchantName: 'TESCO', coarseLocation: null, query: 'TESCO business merchant', cacheKey: 'tesco' });
    mocks.research.mockResolvedValue(mockMerchantResearch('TESCO business merchant'));
    mocks.model.mockResolvedValueOnce({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.3, reason: 'Merchant identity is uncertain.' }] });
    mocks.model.mockResolvedValueOnce({ decisions: [{ journalId: 1, categoryId: 1, confidence: 0.95, reason: 'Public merchant source identifies a supermarket.' }] });
    expect(await processCategorization()).toMatchObject({ aiCategorized: 1, reviewQueued: 0 });
    expect(mocks.research).toHaveBeenCalledExactlyOnceWith(
      { merchantName: 'TESCO', transactionType: 'Card payment', privateNames: ['Jono Taylor'] },
      { signal: expect.any(AbortSignal), timeoutMs: 6_000 },
    );
    expect(JSON.stringify(mocks.research.mock.calls)).not.toContain('1234');
  });
  it('fails closed for public research when the local owner exclusion list cannot be read', async () => {
    mocks.owners.mockRejectedValue(new Error('Private database details'));
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'example-shop' });
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.3, reason: 'Please clarify the purchase.' }] });
    expect(await processCategorization()).toMatchObject({ reviewQueued: 1, aiCategorized: 0, deferredReason: null });
    expect(mocks.research).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('Private');
  });
  it('does not use cited merchant evidence returned for a different public query', async () => {
    mocks.researchQuery.mockReturnValue({ merchantName: 'Example shop', coarseLocation: null, query: 'Example shop UK business', cacheKey: 'example-shop' });
    mocks.research.mockResolvedValue(mockMerchantResearch('Different shop business merchant'));
    mocks.model.mockResolvedValue({ decisions: [{ journalId: 1, categoryId: null, confidence: 0.3, reason: 'Please clarify the purchase.' }] });
    expect(await processCategorization()).toMatchObject({ reviewQueued: 1, aiCategorized: 0, batches: 1 });
    expect(mocks.persistDecisions.mock.calls[0][1][0]).not.toHaveProperty('evidence');
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
  it('bounds one pass to 100 candidates and saves small model batches promptly', async () => {
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 60 }, (_, i) => candidate(i + 1)));
    await processCategorization({ limit: 1000 });
    expect(mocks.listCandidates).toHaveBeenCalledWith(expect.objectContaining({ limit: 100 }));
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual(Array(12).fill(5));
    expect(mocks.persistDecisions.mock.invocationCallOrder[0]).toBeLessThan(mocks.model.mock.invocationCallOrder[1]);
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
    // A complete validated response can still save inside the overall budget
    // even if the shared model clock elapsed just as it arrived.
    expect(result.aiCategorized).toBe(10);
    expect(result.deferredReason).toBe('time_budget');
    expect(result.aiSkippedReason).toContain('time budget');
    expect(mocks.model).toHaveBeenCalledTimes(2);
  });
  it('recovers a stalled batch using one-row calls instead of repeating the same oversized request', async () => {
    vi.useFakeTimers();
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 6 }, (_, i) => candidate(i + 1)));
    // Deliberately ignore the abort signal to exercise the hard execution
    // bound rather than relying on cooperative SDK cancellation.
    mocks.model.mockImplementationOnce(() => new Promise(() => {}));
    const processing = processCategorization();
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await processing;
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual([5, 1, 1, 1, 1, 1, 1]);
    expect(mocks.model.mock.calls[0][2].aborted).toBe(true);
    expect(result).toMatchObject({ aiCategorized: 6, reviewQueued: 0, status: 'complete', deferredReason: null, batches: 7 });
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('stops after a single-row timeout and leaves every undecided entry retryable', async () => {
    vi.useFakeTimers();
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 6 }, (_, i) => candidate(i + 1)));
    mocks.model.mockImplementation(() => new Promise(() => {}));
    mocks.counts.mockResolvedValue({ ...counts, available: 6, remaining: 6, scopeAvailable: 6 });
    const processing = processCategorization();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await processing).toMatchObject({ aiCategorized: 0, reviewQueued: 0, status: 'unavailable', deferredReason: 'time_budget', hasMore: true, batches: 2 });
    expect(mocks.model.mock.calls.map(call => call[0].length)).toEqual([5, 1]);
    expect(mocks.persistDecisions).not.toHaveBeenCalled();
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('keeps successful small batches when the next batch times out', async () => {
    vi.useFakeTimers();
    mocks.listCandidates.mockResolvedValue(Array.from({ length: 10 }, (_, i) => candidate(i + 1)));
    const successfulModel = mocks.model.getMockImplementation()!;
    mocks.model.mockImplementation((rows: CategorizationCandidate[]) => rows[0].id <= 5
      ? successfulModel(rows)
      : new Promise(() => {}));
    mocks.counts.mockResolvedValue({ ...counts, available: 5, remaining: 5, scopeAvailable: 5 });
    const processing = processCategorization();
    await vi.advanceTimersByTimeAsync(16_000);
    expect(await processing).toMatchObject({ aiCategorized: 5, reviewQueued: 0, status: 'partial', deferredReason: 'time_budget', hasMore: true, batches: 3 });
    expect(mocks.persistDecisions).toHaveBeenCalledTimes(1);
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
  });
  it('uses the remaining shared budget for the final attempt and reserves time to finish the pass', async () => {
    vi.useFakeTimers();
    mocks.model.mockImplementation(() => new Promise(() => {}));
    mocks.counts.mockResolvedValue({ ...counts, available: 1, remaining: 1, scopeAvailable: 1 });
    const startedAt = Date.now();
    const processing = processCategorization({ deadlineMs: 2_000, modelTimeoutMs: 20_000 });
    await vi.advanceTimersByTimeAsync(1_800);
    expect(await processing).toMatchObject({ deferredReason: 'time_budget', reviewQueued: 0, batches: 1 });
    expect(Date.now() - startedAt).toBe(1_800);
    expect(mocks.releaseLease).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
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
      if (rows[0].id > 5) { clock = 2001; throw new Error('Provider abort body should remain private'); }
      clock = 1500;
      return { decisions: rows.map(row => ({ journalId: row.id, categoryId: 1, confidence: 0.95, reason: 'Merchant evidence.' })) };
    });
    mocks.counts.mockResolvedValue({ ...counts, available: 45, remaining: 45, scopeAvailable: 45 });
    expect(await processCategorization({ modelTimeoutMs: 1000 })).toMatchObject({ aiCategorized: 5, deferredReason: 'time_budget', status: 'partial', hasMore: true });
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
