import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/categorization/activity', () => ({ loadCategorizationActivity: mocks.load }));
import { GET } from './route';

beforeEach(() => vi.resetAllMocks());
describe('automatic category activity API', () => {
  it('returns a strictly validated private read-only summary', async () => {
    const value = { counts: { standard: 2, estimated: 1, broad: 3 }, items: [], observedAt: '2026-10-25T12:00:00.000Z' };
    mocks.load.mockResolvedValue(value);
    const response = await GET();
    expect(response.status).toBe(200); expect(await response.json()).toEqual(value);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.load).toHaveBeenCalledOnce();
  });
  it('does not substitute an empty count for unavailable activity or expose error details', async () => {
    mocks.load.mockRejectedValue(new Error('private financial query'));
    const response = await GET(); const body = await response.json();
    expect(response.status).toBe(503); expect(body).not.toHaveProperty('counts');
    expect(JSON.stringify(body)).not.toContain('private financial query');
  });
  it('rejects malformed read results instead of acknowledging invented activity', async () => {
    mocks.load.mockResolvedValue({ counts: { standard: null, estimated: 0, broad: 0 }, items: [], observedAt: 'now' });
    expect((await GET()).status).toBe(503);
  });
});
