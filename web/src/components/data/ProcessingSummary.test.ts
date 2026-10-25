import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategorizationResult } from '@/lib/categorization/types';
import ProcessingSummary from './ProcessingSummary';

const result: CategorizationResult = {
  total: 100, ruleBased: 2, aiCategorized: 3, learned: 0, aiNoMatch: 1, reviewQueued: 1, conflicts: 0,
  remaining: 94, needsReview: 1, available: 93, aiSkippedReason: 'The processing time budget was reached.',
  hasMore: true, status: 'partial', batches: 2, busy: false, reviewUrl: '/data', deferredReason: 'time_budget',
};
const render = (value: CategorizationResult, running = false) => renderToString(createElement(ProcessingSummary, { result: value, running, onContinue: () => {} })).replace(/<!-- -->/g, '');

describe('processing progress summary', () => {
  it('retains completed counts and offers continuation for a bounded time pause', () => {
    const html = render(result);
    for (const text of ['5 categorised', '1 sent for review', '93 queued', 'Processing paused at the time limit.',
      'Completed decisions have been saved.', 'Continue processing']) expect(html).toContain(text);
    expect(html).not.toContain('Unavailable');
    expect(html).not.toContain('capacity');
  });

  it('does not claim a completed save when the run made no progress', () => {
    const html = render({ ...result, ruleBased: 0, aiCategorized: 0, reviewQueued: 0, aiNoMatch: 0, status: 'unavailable' });
    expect(html).toContain('Processing paused at the time limit.');
    expect(html).not.toContain('Completed decisions have been saved.');
  });
  it('distinguishes reassessed existing reviews from newly queued questions', () => {
    const html = render({ ...result, reviewQueued: 0, reviewsRechecked: 100 });
    expect(html).toContain('100 existing reviews reassessed');
    expect(html).toContain('0 sent for review');
    expect(html).not.toContain('100 categorised');
  });

  it('keeps provider failure and an actively continuing run distinct from a paused run', () => {
    const running = render(result, true);
    expect(running).not.toContain('Processing paused');
    expect(running).toContain('disabled');
    const failed = render({ ...result, deferredReason: 'model_failed', aiSkippedReason: 'The model request failed.' });
    expect(failed).toContain('The model request failed.');
    expect(failed).not.toContain('Continue processing');
  });
});
