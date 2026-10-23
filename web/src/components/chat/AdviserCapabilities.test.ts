import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { SWRConfig } from 'swr';
import { afterEach, describe, expect, it, vi } from 'vitest';
import AdviserCapabilitiesStatus, { fetchAdviserCapabilities, productionChatHref } from './AdviserCapabilities';
import type { AdviserCapabilities } from '@/lib/ai/capabilities';

const ready: AdviserCapabilities = {
  version: 1,
  capabilities: {
    memory: { read: true, save: true, update: true },
    taxProfile: { read: true, save: true },
    identity: { read: true, save: true },
  },
  release: { commit: null, productionUrl: 'https://current.example.test', environment: 'production' },
};

function render(data?: AdviserCapabilities) {
  return renderToString(createElement(SWRConfig, { value: {
    provider: () => new Map(), fallback: data ? { '/api/ai/capabilities': data } : {},
  } }, createElement(AdviserCapabilitiesStatus))).replace(/<!-- -->/g, '');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('adviser capabilities verified by the current server', () => {
  it('does not promise saving before capabilities have loaded', () => {
    const html = render();
    expect(html).toContain('Checking adviser saving features');
    expect(html).not.toContain('Memory and tax profile saving available');
  });
  it('confirms saving only when the current server advertises the required features', () => {
    expect(render(ready)).toContain('Memory and tax profile saving available');
    const missingWrite = { ...ready, capabilities: { ...ready.capabilities, taxProfile: { read: true, save: false } } };
    const html = render(missingWrite);
    expect(html).toContain('Some adviser saving features are unavailable in this app version');
    expect(html).not.toContain('Memory and tax profile saving available');
  });
  it('requests uncached current capabilities rather than relying on earlier conversation claims', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(ready)));
    vi.stubGlobal('fetch', fetch);
    expect(await fetchAdviserCapabilities('/api/ai/capabilities')).toEqual(ready);
    expect(fetch).toHaveBeenCalledWith('/api/ai/capabilities', { cache: 'no-store' });
  });
  it.each([
    new Response(JSON.stringify({ error: 'Not found' }), { status: 404 }),
    new Response(JSON.stringify({ error: 'Unavailable' }), { status: 503 }),
    new Response(JSON.stringify({ version: 1, capabilities: { taxProfile: { save: true } } })),
    new Response('<html>Old deployment</html>'),
  ])('treats unavailable or malformed responses as unverified, not proof that no tools exist', async response => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    await expect(fetchAdviserCapabilities('/api/ai/capabilities')).rejects.toThrow('could not be verified');
  });
});

describe('current production app link', () => {
  it('uses only the server-supplied production origin and preserves the existing tab', () => {
    expect(productionChatHref('https://current.example.test', 'old-deployment.example.test'))
      .toBe('https://current.example.test/chat');
    expect(productionChatHref('https://current.example.test', 'current.example.test')).toBeNull();
    expect(productionChatHref(null, 'old.example.test')).toBeNull();
  });
  it.each(['javascript:alert(1)', 'http://current.example.test', 'https://user:pass@example.test', 'not a URL'])('rejects an unsafe production URL: %s', url => {
    expect(productionChatHref(url, 'old.example.test')).toBeNull();
  });
});
