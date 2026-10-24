import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ReviewItem } from '@/lib/categorization/review';
import MerchantResearchEvidence from './MerchantResearchEvidence';

const evidence: NonNullable<ReviewItem['evidence']> = {
  status: 'matched', query: 'Example Coffee UK', researchedAt: '2026-10-24T10:00:00.000Z',
  provider: 'gateway_perplexity', scope: 'merchant_identity_only',
  sources: [{ title: 'Example Coffee', url: 'https://example.com/about', snippet: 'A coffee shop.', retrievedAt: '2026-10-24T10:00:00.000Z' }],
};
const render = (value: ReviewItem['evidence']) => renderToString(createElement(MerchantResearchEvidence, { evidence: value })).replace(/<!-- -->/g, '');

describe('merchant research evidence', () => {
  it('shows sourced merchant identity, original research date and the limits of that evidence', () => {
    const html = render(evidence);
    for (const text of ['Merchant research', '24 Oct 2026', 'Example Coffee', 'example.com', 'A coffee shop.',
      'They do not verify what you bought or whether a cost is tax deductible.']) expect(html).toContain(text);
    expect(html).toContain('href="https://example.com/about"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('does not turn an unavailable search or an unsafe URL into evidence', () => {
    expect(render(null)).toBe('');
    for (const url of ['javascript:alert(1)', 'http://example.com', 'https://localhost/a', 'https://127.0.0.1/a',
      'https://[::1]/a', 'https://portal.internal/a', 'https://user:password@example.com/a']) {
      expect(render({ ...evidence, sources: [{ ...evidence.sources[0], url }] })).toBe('');
    }
  });

  it('renders website text as text and keeps only validated links', () => {
    const html = render({ ...evidence, sources: [{ ...evidence.sources[0], title: '<script>writeRecords()</script>', snippet: '<img src=x onerror=writeRecords()>' },
      { ...evidence.sources[0], url: 'javascript:writeRecords()' }] });
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('&lt;img');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
  });
});
