import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SpecialistResult } from '@/lib/ai/specialists/contracts';
import SpecialistReviews from './SpecialistReviews';

const result: SpecialistResult = {
  specialistId: 'tax', name: 'Tax specialist', status: 'partial', scope: 'read_only',
  durationMs: 20, modelId: 'fixture', promptVersion: '1', message: 'The tax year still needs confirming.',
  sources: [{ id: 'tax:1', tool: 'get_owner_tax_profile', observedAt: '2026-10-24T10:00:00.000Z',
    status: 'available', parameters: { tax_year: '2026-27' }, truncated: true }],
  report: {
    summary: 'A partial estimate needs more evidence.',
    findings: [{ title: 'PAYE is unconfirmed', detail: 'Missing payroll tax is unknown rather than zero.', priority: 'high', evidenceIds: ['tax:1'] }],
    gaps: [{ field: 'PAYE paid', why: 'It changes the balance still owed.' }],
    actions: [{ title: 'Check the P60', reason: 'Confirm the actual annual amounts.', priority: 'high' }],
    assumptions: ['Bonus timing is unconfirmed.'], warnings: ['A calculation is not a filing-ready tax bill.'],
  },
};
const render = (results: SpecialistResult[], pending: ('tax' | 'spending')[] = []) => renderToString(createElement(SpecialistReviews, { results, pending })).replace(/<!-- -->/g, '');

describe('specialist review evidence and limitations', () => {
  it('does not invent a review when no specialist ran', () => {
    expect(render([])).toBe('');
    expect(render([], ['tax'])).toContain('Tax specialist reviewing');
    expect(render([], ['tax'])).not.toContain('Reviewed');
  });
  it('shows partial status, actual evidence, missing information and planning assumptions together', () => {
    const html = render([result]);
    for (const text of ['Needs information', 'PAYE is unconfirmed', 'PAYE paid', 'Check the P60', 'Bonus timing is unconfirmed',
      'A calculation is not a filing-ready tax bill', 'Tax profile', '2026-27', 'Partial source read']) expect(html).toContain(text);
    expect(html).toContain('Specialists do not change your records');
    expect(html).toContain('does not confirm that its underlying records are complete');
  });
  it('keeps unavailable results distinct from evidence-backed findings', () => {
    const html = render([{ ...result, status: 'unavailable', report: null, sources: [], message: 'This review could not be completed.' }]);
    expect(html).toContain('Unavailable');
    expect(html).toContain('This review could not be completed');
    expect(html).not.toContain('PAYE is unconfirmed');
    expect(html).not.toContain('Evidence read for this review');
  });
  it('renders imported or generated text as text, never active HTML instructions', () => {
    const html = render([{ ...result, report: { ...result.report!, summary: '<script>changeRecords()</script>' } }]);
    expect(html).not.toContain('<script>changeRecords()');
    expect(html).toContain('&lt;script&gt;');
  });
});
