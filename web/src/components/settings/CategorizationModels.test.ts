import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationModelsResponse, ModelEvaluationResult } from '@/lib/ai/categorization-models/types';
import { CategorizationModelsDetails, fetchCategorizationModels, parseCategorizationModels } from './CategorizationModels';

const time = '2026-10-24T18:00:00.000Z';
const id = '1f935b2c-77c9-49f9-b9b8-50dc84f5ee1b';
const empty: CategorizationModelsResponse = {
  revision: 0, running: null, lastReport: null, selection: null, gatewayConfigured: true,
  active: { modelId: 'openai/gpt-4.1-mini', source: 'default' },
  catalog: { status: 'available', observedAt: time, models: [{ id: 'openai/gpt-4.1-mini', name: 'GPT-4.1 mini', inputUsdPerMillion: 0.4, outputUsdPerMillion: 1.6 }] },
};
const qualified: ModelEvaluationResult = {
  modelId: 'openai/gpt-4.1-mini', status: 'complete', qualified: true,
  correct: 10, total: 10, unsafeAutoApplied: 0, invalidBatches: 0, reviewCount: 5,
  completedBatches: 2, totalBatches: 2, meanLatencyMs: 1250, maxLatencyMs: 1500, estimatedCostUsd: 0.0015,
};
const measured = (results: ModelEvaluationResult[] = [qualified]): CategorizationModelsResponse => ({
  ...empty, revision: 2, active: { modelId: qualified.modelId, source: 'qualified' },
  selection: { modelId: qualified.modelId, benchmarkId: id, benchmarkVersion: 'fixture-v1', selectedAt: time },
  lastReport: {
    id, benchmarkVersion: 'fixture-v1', startedAt: time, completedAt: time, catalogObservedAt: time,
    status: 'complete', results, recommendedModelId: qualified.modelId, applied: true,
    message: 'A qualifying recommendation was saved from this comparison.',
  },
});
const render = (data: CategorizationModelsResponse, pending = false) => renderToString(createElement(CategorizationModelsDetails, {
  data, pending, onCompare: () => {},
})).replace(/<!-- -->/g, '');
afterEach(() => { vi.unstubAllGlobals(); });

describe('measured categorisation model settings', () => {
  it('keeps the configured default separate from unmeasured performance', () => {
    const html = render(empty);
    expect(html).toContain('Default · not benchmark-selected');
    expect(html).toContain('No completed comparison is saved yet');
    expect(html).toContain('have not been measured');
    expect(html).not.toContain('0/10 correct');
    expect(html).not.toContain('Qualified in sample');
    expect(html).toContain('ten synthetic payment examples');
  });
  it('shows the sample evidence, actual review count, latency and estimated cost', () => {
    const html = render(measured());
    for (const value of ['Measured selection', '10/10 correct', '0 observed', '5/10', '1.3 s', '$0.0015', 'Qualified in sample', 'fixture-v1', '24 Oct 2026']) expect(html).toContain(value);
    expect(html).toContain('small synthetic sample');
    expect(html).toContain('not your transaction backlog');
    expect(html).toContain('Your bank transactions are not sent as test examples');
    expect(html).not.toContain('best model in the world');
  });
  it('does not convert timed-out or unavailable measurements into zero accuracy or zero cost', () => {
    const html = render(measured([{ ...qualified, status: 'timed_out', qualified: false, correct: 0,
      completedBatches: 0, reviewCount: null, estimatedCostUsd: null, meanLatencyMs: 8000, maxLatencyMs: 8000,
    }]));
    expect(html).toContain('Timed out');
    expect(html).toContain('Incomplete');
    expect(html).toContain('0/2 batches returned');
    expect(html).toContain('Not measured');
    expect(html).toContain('Not available');
    expect(html).not.toContain('0/10 correct');
    expect(html).not.toContain('0 observed');
    expect(html).not.toContain('$0.0000');
  });
  it('makes an override and an in-progress comparison explicit without promising an automatic switch', () => {
    const html = render({ ...measured(), active: { modelId: 'anthropic/claude-haiku-4.5', source: 'env' },
      running: { id, startedAt: time, expiresAt: '2026-10-24T18:01:00.000Z' },
    });
    expect(html).toContain('Workspace override');
    expect(html).toContain('will not change the active model until that override is removed');
    expect(html).toContain('current selection stays in use');
    expect(html).toContain('disabled');
  });
  it('keeps provider/catalogue unavailability separate from an empty or successful comparison', () => {
    const html = render({ ...empty, gatewayConfigured: false, catalog: { ...empty.catalog, status: 'unavailable', models: [] } });
    expect(html).toContain('AI Gateway access is unavailable');
    expect(html).toContain('model availability is unverified');
    expect(html).not.toContain('0 models listed');
    expect(html).toContain('disabled');
  });
});

describe('categorisation model response validation', () => {
  it('requests fresh results and strips unrelated top-level response fields', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...empty, providerDebug: 'ignored' })));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchCategorizationModels('/api/settings/categorization-models')).toEqual(empty);
    expect(fetch).toHaveBeenCalledWith('/api/settings/categorization-models', { cache: 'no-store' });
  });
  it('rejects invalid metric or active-model data without displaying raw response details', () => {
    expect(() => parseCategorizationModels({ ...empty, active: { modelId: 'untrusted text', source: 'qualified' } })).toThrow('could not be verified');
    const report = measured();
    expect(() => parseCategorizationModels({ ...report, lastReport: { ...report.lastReport, results: [{ ...qualified, estimatedCostUsd: -1 }] } })).toThrow('could not be verified');
  });
});
