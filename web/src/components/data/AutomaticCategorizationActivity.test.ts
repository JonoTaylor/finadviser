import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategorizationActivity } from '@/lib/categorization/activity-schema';
import { AutomaticCategorizationActivityContent, automaticActivityAmount, automaticCategoryLabel, parseAutomaticCategorizationActivity } from './AutomaticCategorizationActivity';

const data: CategorizationActivity = {
  counts: { standard: 2, estimated: 1, broad: 1 },
  items: [{
    journalId: 1, date: '2026-08-23', description: 'SYNTHETIC DINER GBR', merchantName: 'Synthetic Diner',
    categoryId: 2, categoryName: 'Dining', assignmentKind: 'estimated', confidence: 0.85,
    reason: 'Restaurant spending estimated from the merchant and bank hint.', currency: 'GBP', amount: '-11.08',
    updatedAt: '2026-10-25T18:00:00.000Z', evidence: null,
  }, {
    journalId: 2, date: '2026-08-24', description: 'SYNTHETIC CARD PURCHASE', merchantName: null,
    categoryId: 3, categoryName: 'Spending details unknown', assignmentKind: 'broad', confidence: 0.2,
    reason: 'Card spending recorded; the exact purchase details remain unknown.', currency: null, amount: '-22.57',
    updatedAt: '2026-10-25T18:00:01.000Z', evidence: null,
  }],
  observedAt: '2026-10-25T18:01:00.000Z',
};
const render = (value: CategorizationActivity) => renderToString(createElement(AutomaticCategorizationActivityContent, { data: value })).replace(/<!-- -->/g, '');

describe('automatic spending activity', () => {
  it('keeps estimates and broad labels visible without requiring an approval', () => {
    const html = render(data);
    for (const text of ['4 AI labels saved', '1 estimated', '1 with details unknown', 'Estimated', 'Details unknown',
      'Spending details unknown', 'remain in your spending totals', 'Refine in transactions', 'GBP −11.08',
      'Currency not recorded −22.57', 'exact purchase details remain unknown']) expect(html).toContain(text);
    expect(html).not.toContain('Approve');
    expect(html).not.toContain('verified');
    expect(html).toContain('do not establish a purchase');
    expect(html).toContain('href="/transactions"');
  });

  it('does not present an empty AI activity source as no automatic work anywhere', () => {
    const html = render({ ...data, counts: { standard: 0, estimated: 0, broad: 0 }, items: [] });
    expect(html).toContain('No AI category labels are recorded yet.');
    expect(html).toContain('Saved rules and recognised services may have organised other payments.');
    expect(html).not.toContain('Recent automatic labels');
  });

  it('validates source data and never substitutes empty counts for an unavailable or malformed response', () => {
    expect(parseAutomaticCategorizationActivity(data)).toEqual(data);
    for (const value of [null, { error: 'Unavailable' }, { ...data, counts: { standard: 1, estimated: -1, broad: 0 } },
      { ...data, counts: { standard: 1 } }, { ...data, observedAt: 'invalid' },
      { ...data, items: [data.items[0], data.items[0]] },
      { ...data, items: [{ ...data.items[0], assignmentKind: 'verified' }] }]) {
      expect(() => parseAutomaticCategorizationActivity(value)).toThrow('could not be verified');
    }
  });

  it('keeps exact signed financial amounts separate from missing amount context', () => {
    expect(automaticActivityAmount('-1000000.01', 'GBP')).toBe('GBP −1,000,000.01');
    expect(automaticActivityAmount('0', 'GBP')).toBe('GBP 0.00');
    expect(automaticActivityAmount('5.2', 'EUR')).toBe('EUR +5.20');
    expect(automaticActivityAmount(null, 'GBP')).toBe('Amount context unavailable');
    expect(automaticActivityAmount('-11.08', null)).toBe('Currency not recorded −11.08');
  });

  it('labels standard AI output as automatic without upgrading it to a human confirmation', () => {
    expect(automaticCategoryLabel('standard')).toBe('Automatic');
    expect(automaticCategoryLabel('estimated')).toBe('Estimated');
    expect(automaticCategoryLabel('broad')).toBe('Details unknown');
  });

  it('keeps recent labels collapsed and preserves the recorded reason as escaped text', () => {
    const html = render({ ...data, items: [{ ...data.items[0], reason: '<script>private instructions</script>' }] });
    expect(html).toContain('Recent automatic labels (1)');
    expect(html).not.toContain('<details open');
    expect(html).toContain('&lt;script&gt;private instructions&lt;/script&gt;');
    expect(html).not.toContain('<script>private instructions</script>');
  });
});
