import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV2, LanguageModelV2CallOptions } from '@ai-sdk/provider';
import type { generateText, ToolSet } from 'ai';
const mocks = vi.hoisted(() => ({ generate: vi.fn(), execute: vi.fn() }));
vi.mock('ai', async importOriginal => ({ ...await importOriginal<typeof import('ai')>(), generateText: mocks.generate }));
import { TOOL_DEFINITIONS } from '@/lib/ai/tools';
import { getSpecialist, specialistIds } from './catalog';
import {
  buildSpecialistTools, executeSpecialistRead, isSpecialistReadAllowed, runSpecialistReview,
  runSpecialistReviews, validateSpecialistEvidence, type SpecialistRuntimeInput,
} from './runtime';
import type { SpecialistReport } from './contracts';

const report = (id?: string): SpecialistReport => ({ summary: 'Review of recorded evidence, with remaining gaps.',
  findings: id ? [{ title: 'Recorded source', detail: 'This conclusion refers to the returned evidence.', priority: 'medium', evidenceIds: [id] }] : [],
  gaps: [], actions: [], assumptions: [], warnings: [],
});
const input = (): SpecialistRuntimeInput => ({
  ids: ['tax', 'property'], userMessage: 'Review my rental tax and property evidence.', history: [], memory: null,
  model: 'fixture/model', modelId: 'fixture/model', referenceDate: '2026-10-24', currentTaxYear: '2026-27',
  definitions: TOOL_DEFINITIONS, executeTool: mocks.execute,
});
const state = () => ({ sources: [], calls: 0, budgetExceeded: false, unavailableData: false, token: 'fixture-run' });
async function readSource(options: { tools?: ToolSet }) {
  const execute = options.tools?.get_data_intelligence?.execute;
  if (!execute) throw new Error('Missing expected read tool');
  return await execute({}, { toolCallId: 'fixture-call', messages: [] }) as { sourceId: string };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue({ status: 'ready', recordedMonths: 3 });
  mocks.generate.mockImplementation(async options => ({ text: JSON.stringify(report((await readSource(options)).sourceId)) }));
});

describe('read-only specialist execution', () => {
  it('requires both exact allowlists and refuses a forced mutation before touching its executor', async () => {
    expect(isSpecialistReadAllowed('tax', 'get_owner_tax_computation')).toBe(true);
    expect(isSpecialistReadAllowed('spending', 'get_owner_tax_computation')).toBe(false);
    const context = { state: state(), signal: new AbortController().signal, executeTool: mocks.execute };
    expect(await executeSpecialistRead('tax', 'remember', { content: 'Forged fact' }, context)).toHaveProperty('error');
    expect(mocks.execute).not.toHaveBeenCalled();
    const tools = buildSpecialistTools('tax', input(), state(), context.signal);
    expect(tools.get_owner_tax_profile).toBeDefined();
    for (const name of ['remember', 'update_owner_tax_profile', 'set_budget', 'bulk_add_mortgage_payments', 'correct_mortgage_payment_date']) expect(tools[name]).toBeUndefined();
  });
  it('returns an evidence-linked report with only actual source calls', async () => {
    const result = await runSpecialistReview('tax', input());
    expect(result).toMatchObject({ specialistId: 'tax', status: 'complete', scope: 'read_only', modelId: 'fixture/model' });
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0]).toMatchObject({ tool: 'get_data_intelligence', status: 'available', truncated: false });
    expect(result.report?.findings[0].evidenceIds).toEqual([result.sources[0].id]);
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith('get_data_intelligence', {});
    expect(mocks.generate.mock.calls[0][0]).toMatchObject({ maxRetries: 0, maxOutputTokens: 1800 });
  });
  it('keeps no-evidence, failed inner sources and truncated reads partial rather than verified', async () => {
    mocks.generate.mockResolvedValueOnce({ text: JSON.stringify(report()) });
    expect((await runSpecialistReview('tax', input())).status).toBe('partial');
    mocks.execute.mockResolvedValueOnce({ features: { pensions: { status: 'unavailable' } } });
    expect((await runSpecialistReview('tax', input())).status).toBe('partial');
    mocks.execute.mockResolvedValueOnce({ rows: 'x'.repeat(25_000) });
    const truncated = await runSpecialistReview('tax', input());
    expect(truncated.status).toBe('partial');
    expect(truncated.sources[0].truncated).toBe(true);
  });
  it('rejects missing, failed, unknown and cross-run evidence IDs', async () => {
    const source = { id: 'current:s1', tool: 'get_data_intelligence', observedAt: '2026-10-24T00:00:00.000Z', status: 'available' as const, truncated: false, parameters: {} };
    expect(validateSpecialistEvidence(report('current:s1'), [source])).toBe(true);
    expect(validateSpecialistEvidence({ ...report('current:s1'), findings: [{ ...report('current:s1').findings[0], evidenceIds: [] }] }, [source])).toBe(false);
    expect(validateSpecialistEvidence(report('old-run:s1'), [source])).toBe(false);
    expect(validateSpecialistEvidence(report('current:s1'), [{ ...source, status: 'unavailable' }])).toBe(false);
    expect(validateSpecialistEvidence(report('current:s1'), [source, source])).toBe(false);
    mocks.generate.mockImplementationOnce(async options => { await readSource(options); return { text: JSON.stringify(report('invented')) }; });
    expect(await runSpecialistReview('tax', input())).toMatchObject({ status: 'unavailable', report: null });
  });
  it('bounds source reads and does not expose raw backend failures', async () => {
    const current = state();
    const context = { state: current, signal: new AbortController().signal, executeTool: mocks.execute };
    for (let index = 0; index < 9; index++) await executeSpecialistRead('tax', 'get_data_intelligence', {}, context);
    expect(mocks.execute).toHaveBeenCalledTimes(8);
    expect(current.sources).toHaveLength(8);
    expect(current.budgetExceeded).toBe(true);
    mocks.execute.mockRejectedValueOnce(new Error('postgres://private-finance-secret'));
    const failure = await executeSpecialistRead('tax', 'get_data_intelligence', {}, { ...context, state: state() });
    expect(JSON.stringify(failure)).not.toContain('private-finance');
  });
  it('ends a non-cooperating model at its deadline and stops a cancelled request before any read', async () => {
    const never = vi.fn(() => new Promise(() => {})) as unknown as typeof generateText;
    const timed = await runSpecialistReview('tax', input(), { generate: never, workerMs: 5 });
    expect(timed).toMatchObject({ status: 'unavailable', report: null });
    const controller = new AbortController(); controller.abort();
    expect(await runSpecialistReview('tax', { ...input(), signal: controller.signal })).toMatchObject({ status: 'cancelled', sources: [] });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
  it('runs seven distinct reviewers with at most three concurrent model calls and survives one failure', async () => {
    let active = 0; let peak = 0;
    mocks.generate.mockImplementation(async options => {
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, 2));
      try {
        if (options.system.startsWith(getSpecialist('tax').prompt)) throw new Error('Fixture reviewer unavailable');
        return { text: JSON.stringify(report((await readSource(options)).sourceId)) };
      } finally { active--; }
    });
    const events = [];
    for await (const event of runSpecialistReviews({ ...input(), ids: [...specialistIds] })) events.push(event);
    expect(peak).toBeLessThanOrEqual(3);
    expect(events.filter(event => event.type === 'specialist-start')).toHaveLength(7);
    const results = events.filter(event => event.type === 'specialist-result').map(event => event.result);
    expect(results).toHaveLength(7);
    expect(new Set(results.map(result => result.specialistId)).size).toBe(7);
    expect(results.some(result => result.status === 'complete')).toBe(true);
    expect(results.find(result => result.specialistId === 'tax')?.status).toBe('unavailable');
    expect(results.filter(result => result.status === 'complete')).toHaveLength(6);
  });
  it('uses the real AI SDK tool loop for a specialist model and its observed source ID', async () => {
    const sdk = await vi.importActual<typeof import('ai')>('ai');
    const calls: LanguageModelV2CallOptions[] = [];
    const model: LanguageModelV2 = {
      specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
      doStream: async () => { throw new Error('This worker uses generateText'); },
      doGenerate: async options => {
        calls.push(options);
        if (calls.length === 1) return { content: [{ type: 'tool-call', toolCallId: 'source', toolName: 'get_data_intelligence', input: '{}' }], finishReason: 'tool-calls', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
        const sourceId = JSON.stringify(options.prompt).match(/"sourceId":"([^"]+)"/)?.[1];
        if (!sourceId) throw new Error('No actual source ID returned to the model');
        return { content: [{ type: 'text', text: JSON.stringify(report(sourceId)) }], finishReason: 'stop', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, warnings: [] };
      },
    };
    const result = await runSpecialistReview('tax', { ...input(), model }, { generate: sdk.generateText });
    expect(calls).toHaveLength(2);
    expect(result.status).toBe('complete');
    expect(calls[0].tools?.map(value => value.name)).not.toContain('update_owner_tax_profile');
    expect(result.report?.findings[0].evidenceIds).toEqual([result.sources[0].id]);
  });
});
