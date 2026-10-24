import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';
import CategorizationJobProgress from './CategorizationJobProgress';
import { canAutomaticallyStartCategorization, isFinancialDataKey } from './useDataProcessing';

const job: CategorizationJob = {
  id: '0b3f4d52-a902-465e-a209-507fc0649c1a', status: 'running', cancelRequested: false, pauseRequested: false,
  countsExact: true, passes: 2, totals: { total: 100, ruleBased: 1, aiCategorized: 32, learned: 0, reviewQueued: 23, conflicts: 0, batches: 8 },
  latestResult: null, counts: { remaining: 1103, needsReview: 339, available: 764 },
  countsObservedAt: '2026-10-24T18:05:00.000Z', scopeAvailable: 764, maxJournalId: 2000,
  pauseReason: null, message: null, dispatchIssue: null, createdAt: '2026-10-24T18:00:00.000Z', updatedAt: '2026-10-24T18:05:00.000Z',
  finishedAt: null, leaseExpiresAt: '2026-10-24T18:06:30.000Z',
};
const render = (value: CategorizationJob, options: { issue?: string | null; backgroundAvailable?: boolean } = {}) => renderToString(createElement(CategorizationJobProgress, {
  job: value, onPause: () => {}, onResume: () => {}, onCancel: () => {}, backgroundAvailable: true, ...options,
})).replace(/<!-- -->/g, '');

describe('durable categorisation progress', () => {
  it('uses confirmed job totals and observed backlog counts without reconstructing previous sessions', () => {
    const html = render(job);
    for (const value of ['33 categorised', '23 sent for review', '2 confirmed passes', '764 eligible for automatic processing', '339 need review', 'Checked 24 Oct']) expect(html).toContain(value);
    expect(html).not.toContain('176');
    expect(html).not.toContain('Ready for the next batch');
    expect(html).toContain('You can leave this page');
  });
  it('keeps queued dispatch distinct from an executing pass and surfaces handoff issues', () => {
    const queued = render({ ...job, status: 'queued' });
    expect(queued).toContain('Queued to continue');
    expect(queued).toContain('This run is queued on the server');
    expect(queued).not.toContain('This pass runs on the server');
    const unavailable = render({ ...job, status: 'queued' }, { issue: 'The next pass could not be dispatched.' });
    expect(unavailable).toContain('The next pass could not be dispatched.');
    expect(unavailable).not.toContain('You can leave this page');
  });
  it('keeps uncertain job totals explicit and does not invent zeros for missing backlog data', () => {
    const uncertain = render({ ...job, countsExact: false, counts: null, countsObservedAt: null });
    expect(uncertain).toContain('At least 33 categorised');
    expect(uncertain).toContain('An interrupted pass could not be fully reconciled');
    expect(uncertain).toContain('Remaining records have not been counted yet');
    expect(uncertain).not.toContain('0 eligible');
    const noConfirmedTotal = render({ ...job, countsExact: false, totals: { ...job.totals, ruleBased: 0, aiCategorized: 0 } });
    expect(noConfirmedTotal).toContain('Categorised total unconfirmed');
    expect(noConfirmedTotal).not.toContain('0 categorised');
  });
  it('does not present a finished automatic run as complete finances or a cleared review queue', () => {
    const html = render({ ...job, status: 'completed', scopeAvailable: 0, counts: { remaining: 339, needsReview: 339, available: 0 } });
    expect(html).toContain('Automatic run finished');
    expect(html).toContain('339 need review');
    expect(html).toContain('Review questions and missing financial information may still need your attention');
    expect(html).not.toContain('Pause after this pass');
  });
  it('makes stopping after an in-flight pass explicit and offers deliberate controls when paused', () => {
    const pausing = render({ ...job, pauseRequested: true });
    expect(pausing).toContain('Pausing after the current pass');
    expect(pausing).toContain('disabled');
    const paused = render({ ...job, status: 'paused', pauseReason: 'model_failed', message: 'AI categorisation could not finish this pass.' });
    expect(paused).toContain('Resume processing');
    expect(paused).toContain('End this run');
    expect(paused).toContain('AI categorisation could not finish this pass.');
    expect(render({ ...job, status: 'paused', pauseRequested: true })).toContain('Processing paused');
    expect(render({ ...job, status: 'paused', pauseRequested: true })).not.toContain('Pausing after the current pass');
    expect(render({ ...job, status: 'cancelled', cancelRequested: true })).toContain('Processing stopped');
    expect(render({ ...job, status: 'cancelled', cancelRequested: true })).not.toContain('Stopping after the current pass');
  });
});

describe('dashboard processing start policy', () => {
  it('starts new work only when eligible records exist and no paused, cancelled or active run blocks it', () => {
    expect(canAutomaticallyStartCategorization(null, 764)).toBe(true);
    expect(canAutomaticallyStartCategorization({ ...job, status: 'completed' }, 5)).toBe(true);
    for (const status of ['queued', 'running', 'paused', 'cancelled'] as const) expect(canAutomaticallyStartCategorization({ ...job, status }, 764)).toBe(false);
    for (const available of [0, null, undefined]) expect(canAutomaticallyStartCategorization(null, available)).toBe(false);
  });
  it('does not recursively refresh the job observer when derived financial data is revalidated', () => {
    expect(isFinancialDataKey('/api/categorization/jobs')).toBe(false);
    expect(isFinancialDataKey('/api/spending')).toBe(true);
  });
});
