import { describe, expect, it } from 'vitest';
import { parseMerchantResearchEvidence, merchantResearchResultSchema } from './schema';
import type { MerchantResearchResult } from './types';

const evidence: MerchantResearchResult = {
  status: 'matched', query: 'Tesco business merchant',
  sources: [{ title: 'Tesco', url: 'https://www.tesco.com/', snippet: 'A supermarket and general retailer.', retrievedAt: '2026-10-24T12:00:00.000Z' }],
  researchedAt: '2026-10-24T12:00:00.000Z', provider: 'gateway_perplexity', scope: 'merchant_identity_only',
};

describe('merchant evidence validation', () => {
  it('preserves the actual public query, citations, provider and retrieval time', () => {
    expect(parseMerchantResearchEvidence(evidence)).toEqual(evidence);
  });

  it.each([
    { ...evidence, status: 'unavailable' },
    { ...evidence, sources: [] },
    { ...evidence, scope: 'purchase_purpose' },
    { ...evidence, query: 'Payment to Jono ref 123456 business merchant' },
    { ...evidence, ownerId: 42 },
    { ...evidence, sources: [{ ...evidence.sources[0], url: 'https://127.0.0.1/admin' }] },
    { ...evidence, sources: [{ ...evidence.sources[0], url: 'javascript:alert(1)' }] },
    { ...evidence, sources: [{ ...evidence.sources[0], retrievedAt: 'yesterday' }] },
  ])('rejects unavailable, private or malformed provenance', value => {
    expect(parseMerchantResearchEvidence(value)).toBeNull();
  });

  it('validates a negative search result for caching without treating it as evidence', () => {
    const result = { ...evidence, status: 'no_matches', sources: [] };
    expect(merchantResearchResultSchema.safeParse(result).success).toBe(true);
    expect(parseMerchantResearchEvidence(result)).toBeNull();
  });
});
