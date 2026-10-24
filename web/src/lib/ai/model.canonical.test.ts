import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const get = vi.hoisted(() => vi.fn());
vi.mock('@/lib/repos/app-settings.repo', () => ({ appSettingsRepo: { get } }));
import { canonicalGatewayModelId, DEFAULT_MODEL_ID, resolveModelId } from './model';
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue(null); vi.stubEnv('MODEL_ID', ''); });
afterEach(() => vi.unstubAllEnvs());
describe('canonical Gateway model identifiers', () => {
  it('uses known Gateway dotted Anthropic IDs and does not invent unsupported versions', () => {
    expect(DEFAULT_MODEL_ID).toBe('anthropic/claude-sonnet-4.5');
    expect(canonicalGatewayModelId('anthropic/claude-haiku-4-5')).toBe('anthropic/claude-haiku-4.5');
    expect(canonicalGatewayModelId('anthropic/claude-sonnet-4-7')).toBe('anthropic/claude-sonnet-4-7');
    expect(canonicalGatewayModelId('fixture/custom-model')).toBe('fixture/custom-model');
  });
  it('resolves a known legacy saved ID canonically without rewriting the user setting', async () => {
    get.mockResolvedValue('anthropic/claude-opus-4-7');
    expect(await resolveModelId()).toEqual({ modelId: 'anthropic/claude-opus-4.7', source: 'db' });
    expect(get).toHaveBeenCalledOnce();
  });
  it('canonicalises a known environment alias and otherwise keeps the default resolution', async () => {
    vi.stubEnv('MODEL_ID', 'anthropic/claude-sonnet-4-6');
    expect(await resolveModelId()).toEqual({ modelId: 'anthropic/claude-sonnet-4.6', source: 'env' });
    vi.stubEnv('MODEL_ID', '');
    expect(await resolveModelId()).toEqual({ modelId: DEFAULT_MODEL_ID, source: 'default' });
  });
});
