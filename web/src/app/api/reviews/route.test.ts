import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  load: vi.fn(), save: vi.fn(), capture: vi.fn(), read: vi.fn(), write: vi.fn(),
  FinanceReviewUnavailableError: class FinanceReviewUnavailableError extends Error {
    constructor() {
      super('The essential financial context is unavailable.');
      this.name = 'FinanceReviewUnavailableError';
    }
  },
}));
vi.mock('@/lib/finance-reviews/load', () => ({
  loadFinanceReviewWorkspace: mocks.load,
  saveFinanceReviewWorkspace: mocks.save,
  captureFinanceReview: mocks.capture,
  FinanceReviewUnavailableError: mocks.FinanceReviewUnavailableError,
}));
vi.mock('@/lib/finance-workspace/store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-workspace/store')>(),
  readWorkspace: mocks.read, writeWorkspace: mocks.write,
}));

import { GET, PUT, POST } from './route';
import { WorkspaceConflictError } from '@/lib/finance-workspace/store';

const editable = {
  actions: [{ id: 'review-debt', status: 'planned', dueDate: null, note: '', evidenceFingerprint: 'a'.repeat(64) }],
  recurring: [{ merchant: 'Streaming service', status: 'confirmed', note: 'Keep for now', expectedMonthlySaving: null }],
};
const envelope = { version: 1, revision: 8, updatedAt: '2026-10-11T12:00:00.000Z', data: { ...editable, snapshots: [] } };
const request = (method: 'PUT' | 'POST', body: unknown) => new NextRequest('http://localhost/api/reviews', {
  method, headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
});
const put = (body: unknown) => PUT(request('PUT', body));
const post = (body: unknown) => POST(request('POST', body));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.load.mockResolvedValue({ workspace: envelope, actions: [], snapshots: [] });
  mocks.save.mockResolvedValue(envelope);
  mocks.capture.mockResolvedValue(envelope);
});

describe('finance review API', () => {
  it('returns the review overview without caching or writing it', async () => {
    const overview = { workspace: envelope, actions: [], recurring: [], snapshots: [] };
    mocks.load.mockResolvedValue(overview);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual(overview);
    expect(mocks.load).toHaveBeenCalledOnce();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('reports an essential overview failure as unavailable instead of an empty review', async () => {
    mocks.load.mockRejectedValue(new mocks.FinanceReviewUnavailableError());
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).not.toHaveProperty('workspace');
    expect(body).not.toHaveProperty('actions');
  });

  it('acknowledges a successful edit from the persisted envelope without a second overview read', async () => {
    mocks.load.mockRejectedValue(new Error('A subsequent overview could be unavailable'));
    const response = await put({ revision: 7, data: editable });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ workspace: envelope });
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(editable, 7);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('captures a server-generated review using only the expected revision', async () => {
    mocks.load.mockRejectedValue(new Error('A subsequent overview could be unavailable'));
    const captured = { ...envelope, data: { ...editable, snapshots: [{ id: 'server-captured' }] } };
    mocks.capture.mockResolvedValue(captured);
    const response = await post({ revision: 7 });
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ workspace: captured });
    expect(mocks.capture).toHaveBeenCalledExactlyOnceWith(7);
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    { revision: 7, data: { ...editable, snapshots: [] } },
    { revision: 7, data: { ...editable, metrics: { netWorth: '999999.00' } } },
    { revision: 7, data: editable, snapshots: [{ id: 'forged' }] },
    { revision: 7, data: editable, force: true },
    { revision: 7, data: { ...editable, actions: [{ ...editable.actions[0], status: 'deferred', dueDate: null }] } },
    { revision: -1, data: editable },
    { revision: 1.5, data: editable },
    { data: editable },
  ])('rejects forged snapshots, metrics and invalid edit envelopes before any storage call: %j', async body => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([
    { revision: 7, snapshots: [] },
    { revision: 7, metrics: { netWorth: '999999.00' } },
    { revision: 7, data: editable },
    { revision: 7, asOf: '2020-01-01' },
    { revision: 7, force: true },
    { revision: 1_000_000_000 },
    { revision: -1 },
    {},
  ])('rejects client-generated review evidence and invalid capture revisions: %j', async body => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'POST'] as const)('rejects malformed JSON for %s before invoking the loaders or storage', async method => {
    const response = await (method === 'PUT' ? put('{broken') : post('{broken'));
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.capture).not.toHaveBeenCalled();
    expect(mocks.load).not.toHaveBeenCalled();
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'POST'] as const)('preserves the CAS conflict for a stale %s without a success acknowledgement', async method => {
    (method === 'PUT' ? mocks.save : mocks.capture).mockRejectedValue(new WorkspaceConflictError());
    const response = await (method === 'PUT' ? put({ revision: 7, data: editable }) : post({ revision: 7 }));
    expect(response.status).toBe(409);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ code: 'WORKSPACE_CONFLICT' });
    expect(body).not.toHaveProperty('workspace');
    expect(body).not.toHaveProperty('saved');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it('returns 400 when a valid-shaped edit fails the helper reference/evidence validation', async () => {
    const validationError = z.object({ actionId: z.literal('known-action') }).safeParse({ actionId: 'forged-action' });
    if (validationError.success) throw new Error('Expected a validation error fixture');
    mocks.save.mockRejectedValue(validationError.error);
    const response = await put({ revision: 7, data: editable });
    expect(response.status).toBe(400);
    expect(await response.json()).not.toHaveProperty('workspace');
    expect(mocks.load).not.toHaveBeenCalled();
  });

  it.each(['GET', 'PUT', 'POST'] as const)('sanitizes unexpected sensitive errors for %s', async method => {
    const secret = 'postgres://private-user:private-password@private-host';
    const mock = method === 'GET' ? mocks.load : method === 'PUT' ? mocks.save : mocks.capture;
    mock.mockRejectedValue(new Error(secret));
    const response = await (method === 'GET' ? GET() : method === 'PUT' ? put({ revision: 7, data: editable }) : post({ revision: 7 }));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
  });
});
