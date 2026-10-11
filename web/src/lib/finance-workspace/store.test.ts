import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const { get, execute } = vi.hoisted(() => ({ get: vi.fn(), execute: vi.fn() }));
vi.mock('@/lib/repos/app-settings.repo', () => ({ appSettingsRepo: { get } }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
import { readWorkspace, writeWorkspace, WorkspaceConflictError, WorkspaceStoredDataError } from './store';

const schema = z.object({ amount: z.string().regex(/^\d+\.\d{2}$/) }).strict();
const initial = { amount: '0.00' };
const saved = { version: 1, revision: 3, updatedAt: '2026-10-11T12:00:00.000Z', data: { amount: '25.01' } };
beforeEach(() => { vi.resetAllMocks(); get.mockResolvedValue(null); });

describe('revision-controlled financial workspaces', () => {
  it('keeps absent records distinguishable from a saved zero', async () => {
    expect(await readWorkspace('test', schema, initial)).toEqual({ version: 1, revision: 0, updatedAt: null, data: initial });
    get.mockResolvedValue(JSON.stringify(saved));
    expect(await readWorkspace('test', schema, initial)).toEqual(saved);
  });
  it.each(['{bad', JSON.stringify({ ...saved, version: 2 }), JSON.stringify({ ...saved, data: { amount: 25 } }), JSON.stringify({ ...saved, revision: 0 })])('rejects invalid stored data without replacing it', async value => {
    get.mockResolvedValue(value);
    await expect(readWorkspace('test', schema, initial)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    await expect(writeWorkspace('test', schema, initial, 0)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    expect(execute).not.toHaveBeenCalled();
  });
  it('validates the data and revision before touching storage', async () => {
    await expect(writeWorkspace('test', schema, { amount: '25.001' }, 0)).rejects.toBeInstanceOf(z.ZodError);
    await expect(writeWorkspace('test', schema, initial, -1)).rejects.toBeInstanceOf(z.ZodError);
    expect(get).not.toHaveBeenCalled();
  });
  it('refuses stale versions and missing rows with nonzero revisions', async () => {
    await expect(writeWorkspace('test', schema, initial, 2)).rejects.toBeInstanceOf(WorkspaceConflictError);
    get.mockResolvedValue(JSON.stringify(saved));
    await expect(writeWorkspace('test', schema, initial, 2)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(execute).not.toHaveBeenCalled();
  });
  it('rejects a conflict detected during the atomic SQL write', async () => {
    execute.mockResolvedValue({ rows: [] });
    await expect(writeWorkspace('test', schema, initial, 0)).rejects.toBeInstanceOf(WorkspaceConflictError);
  });
  it('returns the actual persisted envelope and preserves decimal strings', async () => {
    execute.mockResolvedValue({ rows: [{ value: JSON.stringify({ ...saved, revision: 1 }) }] });
    expect(await writeWorkspace('test', schema, saved.data, 0)).toEqual({ ...saved, revision: 1 });
  });
  it('propagates unavailability instead of returning defaults', async () => {
    get.mockRejectedValue(new Error('unavailable'));
    await expect(readWorkspace('test', schema, initial)).rejects.toThrow('unavailable');
  });
});
