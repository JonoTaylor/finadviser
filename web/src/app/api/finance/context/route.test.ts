import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), lookup: vi.fn() }));
vi.mock('@/lib/finance-workspace/store', async original => ({
  ...await original<typeof import('@/lib/finance-workspace/store')>(),
  readWorkspace: (...args: unknown[]) => mocks.read(...args),
  writeWorkspace: (...args: unknown[]) => mocks.write(...args),
}));
vi.mock('@/lib/finance-context/lookup', async original => ({
  ...await original<typeof import('@/lib/finance-context/lookup')>(),
  loadContextLookup: (...args: unknown[]) => mocks.lookup(...args),
}));

import { GET, PUT } from './route';
import { defaultContext } from '@/lib/finance-context/schema';
import { WorkspaceConflictError, WorkspaceStoredDataError } from '@/lib/finance-workspace/store';

const lookup = {
  asOf: '2026-10-11', owners: [{ id: 12, name: 'Other owner' }, { id: 42, name: 'Jono' }],
  accounts: [{ id: 5, name: 'Current account', accountType: 'ASSET', isInvestment: false, investmentKind: null, ownerId: 42, balance: '450.00', latestJournalDate: '2026-09-15', postingCount: 4, futurePostingCount: 0 }],
};
const envelope = { version: 1, revision: 0, updatedAt: null, data: defaultContext };
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/finance/context', {
  method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body),
}));

beforeEach(() => {
  mocks.read.mockReset().mockResolvedValue(envelope);
  mocks.lookup.mockReset().mockResolvedValue(lookup);
  mocks.write.mockReset().mockImplementation(async (_key, _schema, data) => ({ version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00.000Z', data }));
});

describe('personal context API', () => {
  it('returns actual lookup records while retaining unknown personal ownership', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toEqual({ ...envelope, lookup });
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('saves validated context with the explicit expected revision and actual selected owner', async () => {
    const response = await put({ revision: 0, data: { ownerId: 42, dependants: 0, accountAccessibility: [{ accountId: 5, accessibility: 'restricted' }] } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ version: 1, revision: 1, lookup, data: { ownerId: 42, dependants: 0, taxResidence: null } });
    expect(mocks.write).toHaveBeenCalledWith('finance.context.v1', expect.anything(), body.data, 0);
  });

  it.each([
    { data: { ownerId: 88 }, revision: 0 },
    { data: { accountAccessibility: [{ accountId: 88, accessibility: 'available' }] }, revision: 0 },
    { data: { nextReviewDate: '2026-02-30' }, revision: 0 },
    { data: { taxResidence: 'UK', name: 'Assumed' }, revision: 0 },
    { data: {}, revision: -1 }, { data: {}, revision: 0, force: true },
  ])('rejects invalid facts, foreign IDs and envelopes before writes: %j', async body => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before lookup or writes', async () => {
    expect((await put('{broken')).status).toBe(400);
    expect(mocks.lookup).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('returns a 409 conflict without claiming a stale save succeeded', async () => {
    mocks.write.mockRejectedValue(new WorkspaceConflictError());
    const response = await put({ data: {}, revision: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WORKSPACE_CONFLICT' });
  });

  it('returns unavailable rather than fabricated lookup records when the database fails', async () => {
    mocks.lookup.mockRejectedValue(new Error('postgres://secret'));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.lookup).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain('secret');
    expect((await put({ data: {}, revision: 0 })).status).toBe(503);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('preserves corrupt saved data for review rather than replacing it with defaults', async () => {
    mocks.read.mockRejectedValue(new WorkspaceStoredDataError());
    const response = await GET();
    expect(response.status).toBe(422);
    expect((await response.json()).data).toBeUndefined();
    expect(mocks.write).not.toHaveBeenCalled();
  });
});
