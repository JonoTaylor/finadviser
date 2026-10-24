import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMerchantResearchQuery } from './privacy';
import type { MerchantResearchResult } from './types';

const mocks = vi.hoisted(() => ({ find: vi.fn(), save: vi.fn(), lookup: vi.fn() }));
vi.mock('./repository', () => ({ merchantResearchRepo: { find: mocks.find, save: mocks.save } }));
vi.mock('./provider', () => ({ lookupMerchant: mocks.lookup }));
import { researchMerchant } from './service';

const input = { merchantName: 'Tesco', transactionType: 'card' };
const query = buildMerchantResearchQuery(input)!;
const result: MerchantResearchResult = {
  status: 'matched', query: query.query,
  sources: [{ title: 'Tesco', url: 'https://www.tesco.com/', snippet: 'A supermarket and general retailer.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
  researchedAt: '2026-10-24T12:00:00.000Z', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.find.mockResolvedValue(null);
  mocks.save.mockResolvedValue(true);
  mocks.lookup.mockResolvedValue(result);
});
afterEach(() => vi.useRealTimers());

describe('bounded public merchant research', () => {
  it('reuses public cached sources without changing their retrieval time or researching again', async () => {
    mocks.find.mockResolvedValue(result);
    expect(await researchMerchant(input)).toEqual(result);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('caches actual cited research using only the sanitised public query', async () => {
    expect(await researchMerchant(input)).toEqual(result);
    expect(mocks.save).toHaveBeenCalledWith(query, result);
    expect(mocks.find).toHaveBeenCalledWith(query);
  });

  it('continues without caching when the cache database is unavailable', async () => {
    mocks.find.mockRejectedValue(new Error('Private database connection details'));
    mocks.save.mockRejectedValue(new Error('Private database connection details'));
    expect(await researchMerchant(input)).toEqual(result);
  });

  it('refuses private payment narratives before touching a database or provider', async () => {
    expect(await researchMerchant({ merchantName: 'Payment to Jono ref 123456' })).toMatchObject({ status: 'skipped_private', query: null, sources: [] });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });

  it('does not accept research for another merchant or persist invented citations', async () => {
    mocks.lookup.mockResolvedValue({ ...result, query: 'Asda business merchant' });
    expect(await researchMerchant(input)).toMatchObject({ status: 'unavailable', sources: [] });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('treats provider errors as unavailable without exposing exception details', async () => {
    mocks.lookup.mockRejectedValue(new Error('Provider credential is private'));
    expect(await researchMerchant(input)).toMatchObject({ status: 'unavailable', query: query.query, sources: [] });
  });

  it('bounds a hung cache read and still uses the remaining provider budget', async () => {
    vi.useFakeTimers();
    mocks.find.mockReturnValue(new Promise(() => {}));
    const promise = researchMerchant(input, { timeoutMs: 1000 });
    await vi.advanceTimersByTimeAsync(350);
    expect(await promise).toEqual(result);
    expect(mocks.lookup.mock.calls[0][1].timeoutMs).toBe(650);
  });

  it('bounds the whole request even if the provider ignores cancellation', async () => {
    vi.useFakeTimers();
    mocks.lookup.mockReturnValue(new Promise(() => {}));
    const promise = researchMerchant(input, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await promise).toMatchObject({ status: 'timed_out', sources: [] });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('respects caller cancellation before initiating any lookup', async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await researchMerchant(input, { signal: controller.signal })).toMatchObject({ status: 'timed_out' });
    expect(mocks.find).not.toHaveBeenCalled();
    expect(mocks.lookup).not.toHaveBeenCalled();
  });
});
