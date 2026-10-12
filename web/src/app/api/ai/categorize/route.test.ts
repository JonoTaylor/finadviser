import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ categorize: vi.fn() }));
vi.mock('@/lib/ai/claude-client', () => ({ categorizeBatch: mocks.categorize }));
import { POST } from './route';
const request = (body: unknown) => new NextRequest('https://example.test/api/ai/categorize', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv('AI_GATEWAY_API_KEY', 'test'); mocks.categorize.mockResolvedValue({ shop: 'Groceries' }); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('legacy AI categorisation preview endpoint', () => {
  it('preserves the old mapping response while explicitly marking it read-only and uncached', async () => {
    const response = await POST(request({ descriptions: ['shop'], categories: ['Groceries'] }));
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Finadviser-Preview-Only')).toBe('true');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ shop: 'Groceries' });
    expect(mocks.categorize).toHaveBeenCalledExactlyOnceWith(['shop'], ['Groceries']);
  });
  it.each([
    '{bad', null, [], {}, { descriptions: Array(26).fill('shop'), categories: ['Groceries'] },
    { descriptions: ['a'.repeat(601)], categories: ['Groceries'] },
    { descriptions: ['shop'], categories: Array(101).fill('Groceries') },
    { descriptions: ['shop'], categories: ['Groceries'], categoryId: 123 },
  ])('rejects invalid or write-shaped inputs before model calls: %j', async body => {
    const result = await POST(request(body));
    expect(result.status).toBe(400);
    expect(mocks.categorize).not.toHaveBeenCalled();
  });
  it('reports unavailable model configuration rather than an empty matching result', async () => {
    vi.stubEnv('AI_GATEWAY_API_KEY', '');
    const response = await POST(request({ descriptions: ['shop'], categories: ['Groceries'] }));
    expect(response.status).toBe(503);
    expect(mocks.categorize).not.toHaveBeenCalled();
  });
  it.each(['private provider failure', 'invalid response'])('rejects a %s without echoing transaction or provider data', async mode => {
    if (mode === 'private provider failure') mocks.categorize.mockRejectedValue(new Error('Private account reference body'));
    else mocks.categorize.mockResolvedValue({ shop: { category: 'Groceries', account: 'Private account reference body' } });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST(request({ descriptions: ['shop'], categories: ['Groceries'] }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('Private account');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('Private account');
  });
});
