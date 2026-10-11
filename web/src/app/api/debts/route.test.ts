import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { WorkspaceConflictError, WorkspaceStoredDataError } from '@/lib/finance-workspace/store';
const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/debts/load', () => ({ loadDebtWorkspace: mocks.load, saveDebtWorkspace: mocks.save }));
import { GET, PUT } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/debts', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => { vi.resetAllMocks(); });

describe('debt workspace routes', () => {
  it('returns the saved envelope without caching it', async () => {
    mocks.load.mockResolvedValue({ workspace: { version: 1, revision: 0, updatedAt: null, data: { debts: [] } }, debts: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).workspace.revision).toBe(0);
  });
  it('distinguishes unavailable storage from an empty inventory', async () => {
    mocks.load.mockRejectedValue(new Error('secret database failure'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
  it('rejects malformed saved data instead of replacing it', async () => {
    mocks.load.mockRejectedValue(new WorkspaceStoredDataError());
    expect((await GET()).status).toBe(422);
  });
  it.each([{ data: { debts: [] } }, { data: { debts: [] }, revision: -1 }, { data: { debts: [] }, revision: 0, overwrite: true }])('rejects an invalid write', async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it('preserves the explicit revision on a valid write', async () => {
    mocks.save.mockResolvedValue({ workspace: { revision: 4 } });
    expect((await PUT(request({ data: { debts: [] }, revision: 3 }))).status).toBe(200);
    expect(mocks.save).toHaveBeenCalledWith({ debts: [] }, 3);
  });
  it('returns a conflict that lets the client preserve its form', async () => {
    mocks.save.mockRejectedValue(new WorkspaceConflictError());
    expect((await PUT(request({ data: { debts: [] }, revision: 0 }))).status).toBe(409);
  });
  it('handles unreadable JSON before invoking storage', async () => {
    const response = await PUT(new NextRequest('http://localhost/api/debts', { method: 'PUT', body: '{' }));
    expect(response.status).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
