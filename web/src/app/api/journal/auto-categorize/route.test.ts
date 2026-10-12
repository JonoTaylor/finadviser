import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ process: vi.fn() }));
vi.mock('@/lib/categorization/service', () => ({ processCategorization: mocks.process }));
import { POST } from './route';

beforeEach(() => { vi.resetAllMocks(); mocks.process.mockResolvedValue({ total: 2, aiCategorized: 1, needsReview: 1, status: 'complete' }); });
const request = (body: unknown) => new Request('https://example.test/api/journal/auto-categorize', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
});
describe('automatic categorisation endpoint', () => {
  it('supports existing empty-body callers and returns persisted processing statistics without caching', async () => {
    const response = await POST(request(''));
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(mocks.process).toHaveBeenCalledExactlyOnceWith({ source: 'manual' });
    expect(await response.json()).toMatchObject({ aiCategorized: 1, needsReview: 1 });
  });
  it('passes bounded explicit options to the shared service', async () => {
    expect((await POST(request({ limit: 40, deadlineMs: 12000, modelTimeoutMs: 8000, journalIds: [1, 2] }))).status).toBe(200);
    expect(mocks.process).toHaveBeenCalledWith({ source: 'manual', limit: 40, deadlineMs: 12000, modelTimeoutMs: 8000, journalIds: [1, 2] });
  });
  it.each([
    '{bad', [], null, { limit: 101 }, { limit: 0 }, { limit: 1.5 }, { deadlineMs: 45001 },
    { modelTimeoutMs: 30001 }, { journalIds: [0] }, { journalIds: ['1'] },
    { source: 'scheduled' }, { force: true }, { categoryId: 999 },
  ])('rejects malformed or unbounded options before processing: %j', async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.process).not.toHaveBeenCalled();
  });
  it('reports leased work as busy rather than pretending it processed another batch', async () => {
    mocks.process.mockResolvedValue({ status: 'partial', busy: true, total: 0, remaining: 100 });
    expect(await (await POST()).json()).toMatchObject({ busy: true, total: 0, remaining: 100 });
  });
  it('reports database failure without a success count or private exception details', async () => {
    mocks.process.mockRejectedValue(new Error('Private connection URL and ledger row'));
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const response = await POST();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).not.toHaveProperty('total');
    expect(JSON.stringify(body)).not.toContain('Private');
    expect(JSON.stringify(warning.mock.calls)).not.toContain('Private');
    warning.mockRestore();
  });
});
