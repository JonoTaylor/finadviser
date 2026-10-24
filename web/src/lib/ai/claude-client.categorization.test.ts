import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationCandidate } from '@/lib/categorization/types';

const mocks = vi.hoisted(() => ({ generate: vi.fn(), gateway: vi.fn(), resolve: vi.fn(), classificationModel: vi.fn() }));
vi.mock('ai', async original => ({ ...await original<typeof import('ai')>(), generateText: mocks.generate }));
vi.mock('@ai-sdk/gateway', () => ({ gateway: mocks.gateway }));
vi.mock('./model', () => ({ resolveModelId: mocks.resolve }));
vi.mock('./categorization-models/service', () => ({ resolveCategorizationModelId: mocks.classificationModel }));
vi.mock('./tools', () => ({ TOOL_DEFINITIONS: [], TOOL_LABELS: {}, executeTool: vi.fn() }));
vi.mock('@/lib/repos/ai-memory.repo', () => ({ aiMemoryRepo: {} }));
import { categorizeContextBatch } from './claude-client';

const candidate: CategorizationCandidate = {
  id: 1, date: '2026-10-01', description: 'Example Cafe', merchantName: 'Example Cafe',
  propertyId: null, bankCategory: null, transactionType: 'Card payment', currency: 'GBP', snapshot: 'fixture',
  legs: [{ accountId: 1, accountName: 'Fixture bank', accountType: 'ASSET', ownerId: 1, amount: '-10.00' }],
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('CATEGORIZATION_MODEL_ID', '');
  mocks.gateway.mockReturnValue({ modelId: 'fixture-fast-model' });
  mocks.generate.mockResolvedValue({ text: '{"decisions":[]}' });
  mocks.classificationModel.mockResolvedValue({ modelId: 'openai/gpt-4.1-mini', source: 'default' });
});
afterEach(() => vi.unstubAllEnvs());

describe('background classification model request', () => {
  it('uses the dedicated resolved model without querying the adviser model', async () => {
    const signal = new AbortController().signal;
    await categorizeContextBatch([candidate], [{ id: 2, name: 'Eating out' }], signal);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('openai/gpt-4.1-mini');
    expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: signal, maxRetries: 0, maxOutputTokens: 600 }));
  });
  it('uses the policy resolver result independently of the adviser setting', async () => {
    mocks.classificationModel.mockResolvedValue({ modelId: 'anthropic/claude-haiku-4.5', source: 'qualified' });
    await categorizeContextBatch([candidate], [], new AbortController().signal);
    expect(mocks.gateway).toHaveBeenCalledExactlyOnceWith('anthropic/claude-haiku-4.5');
  });
  it('rejects truncated or unrelated text rather than extracting arbitrary JSON', async () => {
    mocks.generate.mockResolvedValue({ text: 'Here is my guess: {"decisions":[]}' });
    await expect(categorizeContextBatch([candidate], [], new AbortController().signal)).rejects.toThrow('invalid JSON');
  });
});
