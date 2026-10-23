import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LanguageModelV2, LanguageModelV2CallOptions, LanguageModelV2StreamPart } from '@ai-sdk/provider';

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(), gateway: vi.fn(), resolveModel: vi.fn(), memoryPrompt: vi.fn(),
  owner: vi.fn(), profile: vi.fn(), patch: vi.fn(),
}));

// Keep the real SDK tool()/jsonSchema() bridge: this exercises the actual
// registry supplied by runAgent rather than a separate tool definition list.
vi.mock('ai', async importOriginal => ({
  ...await importOriginal<typeof import('ai')>(), streamText: mocks.streamText,
}));
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }));
vi.mock('./model', () => ({ resolveModelId: mocks.resolveModel }));
vi.mock('@/lib/repos/ai-memory.repo', () => ({ aiMemoryRepo: { renderForPrompt: mocks.memoryPrompt } }));
vi.mock('@/lib/repos', () => ({
  propertyRepo: { getOwner: mocks.owner },
  ownerTaxRepo: { getProfile: mocks.profile, patchProfile: mocks.patch },
  aiMemoryRepo: {}, accountRepo: {}, journalRepo: {}, categoryRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {},
}));

import { runAgent } from './claude-client';
import { TaxProfileConflictError } from '@/lib/tax/profileFacts';

interface RegisteredTool {
  description: string;
  inputSchema: unknown;
  execute: (input: unknown, options: { toolCallId: string; messages: [] }) => Promise<unknown>;
}
interface AgentRequest {
  system: string;
  messages: { role: string; content: string }[];
  tools: Record<string, RegisteredTool>;
}
const owner = { id: 2, name: 'Jono Taylor' };
const profile = { ownerId: 2, taxYear: '2026-27', revision: 3, saved: true };
const update = {
  owner_id: 2, tax_year: '2026-27',
  patch: { expectedRevision: 3, facts: { baseSalary: '95000', bonusPercent: 30, bonusIsEstimate: true } },
};
const options = { toolCallId: 'test-call', messages: [] as [] };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.gateway.mockReturnValue({ modelId: 'fixture-model' });
  mocks.resolveModel.mockResolvedValue({ modelId: 'fixture-model', source: 'default' });
  mocks.memoryPrompt.mockResolvedValue(null);
  mocks.owner.mockResolvedValue(owner);
  mocks.profile.mockResolvedValue(profile);
  mocks.patch.mockResolvedValue({ ...profile, revision: 4 });
});

describe('adviser runtime tool registration', () => {
  it('executes a streamed tax-profile call through the real SDK loop and returns its persisted result to the next model step', async () => {
    const actualSdk = await vi.importActual<typeof import('ai')>('ai');
    mocks.streamText.mockImplementation(actualSdk.streamText);
    const stream = (parts: LanguageModelV2StreamPart[]) => new ReadableStream<LanguageModelV2StreamPart>({
      start(controller) { for (const part of parts) controller.enqueue(part); controller.close(); },
    });
    const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };
    const responses = [
        { stream: stream([
          { type: 'stream-start', warnings: [] },
          { type: 'tool-call', toolCallId: 'save-tax', toolName: 'update_owner_tax_profile', input: JSON.stringify(update) },
          { type: 'finish', finishReason: 'tool-calls', usage },
        ]) },
        { stream: stream([
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'reply' },
          { type: 'text-delta', id: 'reply', delta: 'Saved your confirmed facts for 2026-27.' },
          { type: 'text-end', id: 'reply' },
          { type: 'finish', finishReason: 'stop', usage },
        ]) },
      ];
    const calls: LanguageModelV2CallOptions[] = [];
    const scriptedModel: LanguageModelV2 = {
      specificationVersion: 'v2', provider: 'fixture', modelId: 'fixture', supportedUrls: {},
      doGenerate: async () => { throw new Error('This test exercises streaming only.'); },
      doStream: async request => { calls.push(request); return responses[calls.length - 1]; },
    };
    mocks.gateway.mockReturnValue(scriptedModel);
    const events = [];
    for await (const event of runAgent('Save my confirmed salary and bonus for 2026-27.', [
      { role: 'user', content: 'Please save my salary.' },
      { role: 'assistant', content: 'I cannot save tax profiles; that tool is unavailable.' },
    ])) events.push(event);
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(2, '2026-27', {
      expectedRevision: 3, source: 'ai', facts: { baseSalary: '95000.00', bonusPercent: 30, bonusIsEstimate: true },
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].tools?.map(tool => tool.name)).toContain('update_owner_tax_profile');
    expect(JSON.stringify(calls[0].prompt)).toContain('that tool is unavailable');
    expect(JSON.stringify(calls[1].prompt)).toContain('"saved":true');
    expect(JSON.stringify(calls[1].prompt)).toContain('"revision":4');
    expect(events).toContainEqual({ type: 'text', content: 'Saved your confirmed facts for 2026-27.' });
  });

  it('registers the tax profile writer in the actual streamed request and executes its persistence wrapper', async () => {
    let persisted: unknown;
    mocks.streamText.mockImplementation((request: AgentRequest) => ({
      fullStream: (async function* () {
        expect(request.tools.update_owner_tax_profile).toBeDefined();
        expect(request.tools.get_owner_tax_profile).toBeDefined();
        expect(request.tools.save_financial_identity).toBeDefined();
        expect(request.tools.update_memory).toBeDefined();
        expect(request.tools.update_owner_tax_profile.inputSchema).toBeDefined();
        const read = await request.tools.get_owner_tax_profile.execute({ owner_id: 2, tax_year: '2026-27' }, options);
        expect(read).toMatchObject({ owner, profile: { revision: 3 } });
        yield { type: 'tool-call', toolName: 'update_owner_tax_profile' };
        persisted = await request.tools.update_owner_tax_profile.execute(update, options);
        yield { type: 'text-delta', text: 'Saved your tax-year facts.' };
      })(),
    }));
    const events = [];
    for await (const event of runAgent('Save my confirmed salary and bonus for 2026-27.')) events.push(event);
    expect(persisted).toMatchObject({ saved: true, profile: { revision: 4, taxYear: '2026-27' } });
    expect(mocks.patch).toHaveBeenCalledExactlyOnceWith(2, '2026-27', {
      expectedRevision: 3, source: 'ai', facts: { baseSalary: '95000.00', bonusPercent: 30, bonusIsEstimate: true },
    });
    expect(events).toContainEqual({ type: 'tool', name: 'update_owner_tax_profile', label: 'Saving your tax profile' });
    expect(events).toContainEqual({ type: 'text', content: 'Saved your tax-year facts.' });
  });

  it('provides current write capabilities even when old conversation history denied they existed', async () => {
    const oldRefusal = 'I do not have a tool to save your tax profile. You must enter it manually.';
    let requestSeen: AgentRequest | undefined;
    mocks.memoryPrompt.mockResolvedValue('Jono reports an 8% employee pension; method unknown.');
    mocks.streamText.mockImplementation((request: AgentRequest) => {
      requestSeen = request;
      return { fullStream: (async function* () { yield { type: 'text-delta', text: 'Current tools are available.' }; })() };
    });
    for await (const event of runAgent('Please save it now.', [{ role: 'assistant', content: oldRefusal }])) void event;
    expect(requestSeen?.tools.update_owner_tax_profile.execute).toBeTypeOf('function');
    expect(requestSeen?.system).toContain('Do not tell them they must enter supported facts manually');
    expect(requestSeen?.system).toContain('Pension percentages alone do not establish annual contributions');
    expect(requestSeen?.system).toContain('untrusted reference data');
    expect(requestSeen?.messages).toContainEqual({ role: 'assistant', content: oldRefusal });
    expect(requestSeen?.messages.at(-1)).toEqual({ role: 'user', content: 'Please save it now.' });
  });

  it('returns a stale-write conflict through the registered tool rather than claiming persistence succeeded', async () => {
    let toolResult: unknown;
    mocks.patch.mockRejectedValue(new TaxProfileConflictError());
    mocks.streamText.mockImplementation((request: AgentRequest) => ({
      fullStream: (async function* () {
        toolResult = await request.tools.update_owner_tax_profile.execute(update, options);
        yield { type: 'text-delta', text: 'The profile changed; I need the latest revision.' };
      })(),
    }));
    for await (const event of runAgent('Save my tax profile.')) void event;
    expect(toolResult).toMatchObject({ status: 'conflict' });
    expect(toolResult).not.toHaveProperty('saved');
    expect(mocks.patch).toHaveBeenCalledTimes(1);
  });
});
