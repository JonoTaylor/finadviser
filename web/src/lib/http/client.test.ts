import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchJson } from './client';

afterEach(() => vi.unstubAllGlobals());

describe('API client missing-data handling', () => {
  it('rejects unavailable financial data instead of caching the error as balances', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'Financial data unavailable' }), { status: 503 })));
    await expect(fetchJson('/api/planning/overview')).rejects.toThrow('Financial data unavailable');
  });
  it('rejects an unreadable successful response rather than treating it as an empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Proxy error</html>', { status: 200 })));
    await expect(fetchJson('/api/investments')).rejects.toThrow('unreadable response');
  });
  it('preserves a successful empty list as a distinct result from an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('[]', { status: 200 })));
    await expect(fetchJson('/api/investments')).resolves.toEqual([]);
  });
  it('reports HTTP failure when a non-JSON intermediary response is returned', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Service unavailable', { status: 502 })));
    await expect(fetchJson('/api/accounts')).rejects.toThrow('502');
  });
  it('does not hide a failed financial-record mutation', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{"error":"Invalid monthly limit"}', { status: 400 }));
    vi.stubGlobal('fetch', fetch);
    const request = { method: 'POST', body: '{"monthlyLimit":"-5"}' };
    await expect(fetchJson('/api/budgets', request)).rejects.toThrow('Invalid monthly limit');
    expect(fetch).toHaveBeenCalledWith('/api/budgets', request);
  });
});
