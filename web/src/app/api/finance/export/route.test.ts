import { beforeEach, describe, expect, it, vi } from 'vitest';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/finance-reviews/export', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-reviews/export')>(), loadFinancePlanningExport: load,
}));
import { GET } from './route';
import { FinanceExportUnavailableError } from '@/lib/finance-reviews/export';

beforeEach(() => vi.resetAllMocks());

describe('finance planning export API', () => {
  it('downloads a scoped JSON file with no-store caching, including visible optional failures', async () => {
    const data = { schemaVersion: 1, asOf: '2026-10-11', completeBackup: false, workspaces: { debts: { status: 'unavailable' } } };
    load.mockResolvedValue(data);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="finadviser-planning-2026-10-11.json"');
    expect(await response.json()).toEqual(data);
  });

  it.each(['context', 'planningProfile'] as const)('returns 503 and no attachment when essential %s is unavailable', async section => {
    load.mockRejectedValue(new FinanceExportUnavailableError(section, 'ESSENTIAL_SECTION_UNAVAILABLE'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Disposition')).toBeNull();
    expect(await response.json()).toMatchObject({ status: 'unavailable', code: 'ESSENTIAL_SECTION_UNAVAILABLE', section });
  });

  it('does not expose unexpected database or connection errors', async () => {
    const secret = 'postgres://private-user:private-password@private-host';
    load.mockRejectedValue(new Error(secret));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret);
  });
});
