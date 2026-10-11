import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const load = vi.fn();
const write = vi.fn();
const list = vi.fn();
vi.mock('@/lib/property-operations/load', () => ({ loadPropertyOperationsWorkspace: (...args: unknown[]) => load(...args) }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listProperties: (...args: unknown[]) => list(...args) } }));
vi.mock('@/lib/finance-workspace/store', async original => ({
  ...await original<typeof import('@/lib/finance-workspace/store')>(),
  writeWorkspace: (...args: unknown[]) => write(...args),
}));

import { GET, PUT } from './route';
import { WorkspaceConflictError, WorkspaceStoredDataError } from '@/lib/finance-workspace/store';
import { PROPERTY_OPERATIONS_KEY, propertyOperationsSchema } from '@/lib/property-operations/types';

const data = { obligations: [{ id: 'task-1', propertyId: 1, title: 'Insurance renewal', dueDate: '2026-10-11', status: 'open', category: 'insurance' }], reserveTargets: [{ propertyId: 1, targetAmount: '5000.00' }] };
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/property-operations', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  load.mockReset().mockResolvedValue({ version: 1, revision: 0, updatedAt: null, data: { obligations: [], reserveTargets: [] }, summary: { asOf: '2026-10-11' } });
  list.mockReset().mockResolvedValue([{ id: 1, name: 'Flat' }]);
  write.mockReset().mockResolvedValue({ version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00.000Z', data });
});

describe('property operations API', () => {
  it('returns the saved envelope and computed summary without caching financial data', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ revision: 0, summary: { asOf: '2026-10-11' } });
  });

  it('saves validated obligations and reserve targets with the caller revision', async () => {
    const response = await put({ data, revision: 2 });
    expect(response.status).toBe(200);
    expect(write).toHaveBeenCalledWith(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, data, 2);
  });

  it.each([
    { data: { ...data, obligations: [...data.obligations, ...data.obligations] }, revision: 0 },
    { data: { ...data, reserveTargets: [...data.reserveTargets, ...data.reserveTargets] }, revision: 0 },
    { data: { ...data, obligations: [{ ...data.obligations[0], dueDate: '2026-02-30' }] }, revision: 0 },
    { data: { ...data, obligations: [{ ...data.obligations[0], status: 'cancelled' }] }, revision: 0 },
    { data: { ...data, reserveTargets: [{ propertyId: 1, targetAmount: '-1' }] }, revision: 0 },
    { data, revision: -1 }, { data, revision: 1.5 }, { data, revision: 0, force: true },
  ])('rejects invalid requests before property queries or writes: %j', async body => {
    expect((await put(body)).status).toBe(400);
    expect(list).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  it('checks every referenced property against actual recorded IDs', async () => {
    expect((await put({ data: { ...data, obligations: [{ ...data.obligations[0], propertyId: 99 }] }, revision: 0 })).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
    expect((await put({ data: { obligations: [], reserveTargets: [{ propertyId: 99, targetAmount: '1' }] }, revision: 0 })).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });

  it('reports conflicts without claiming a save succeeded', async () => {
    write.mockRejectedValue(new WorkspaceConflictError());
    const response = await put({ data, revision: 1 });
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: 'WORKSPACE_CONFLICT' });
  });

  it('distinguishes corrupt stored workspaces from unavailable data and hides internal failures', async () => {
    load.mockRejectedValue(new WorkspaceStoredDataError());
    expect((await GET()).status).toBe(422);
    load.mockRejectedValue(new Error('postgres://secret@host'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
    list.mockRejectedValue(new Error('sensitive'));
    expect((await put({ data, revision: 0 })).status).toBe(503);
    expect(write).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON', async () => {
    expect((await put('{malformed')).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
});
