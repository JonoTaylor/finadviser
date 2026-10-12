import { beforeEach, expect, it, vi } from 'vitest';
const { loadDataIntelligence } = vi.hoisted(() => ({ loadDataIntelligence: vi.fn() }));
vi.mock('@/lib/data-intelligence/load', () => ({ loadDataIntelligence }));
import { GET } from './route';

beforeEach(() => { vi.clearAllMocks(); });
it('returns a read-only report with private cache control', async () => {
  loadDataIntelligence.mockResolvedValue({ version: 1, status: 'ready', scope: 'household', transactions: { totalCount: 0 }, gaps: [] });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(await response.json()).toMatchObject({ status: 'ready', transactions: { totalCount: 0 } });
  expect(loadDataIntelligence).toHaveBeenCalledOnce();
});
it('preserves partial availability and unknown counts', async () => {
  loadDataIntelligence.mockResolvedValue({ version: 1, status: 'partial', transactions: { totalCount: 12, reviewNeededCount: null }, gaps: [{ status: 'unavailable' }] });
  const response = await GET();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'partial', transactions: { reviewNeededCount: null } });
});
it('does not present an unavailable household as an empty report', async () => {
  loadDataIntelligence.mockResolvedValue({ version: 1, status: 'unavailable', transactions: { totalCount: null } });
  const response = await GET();
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ code: 'DATA_INTELLIGENCE_UNAVAILABLE', status: 'unavailable', transactions: { totalCount: null } });
});
it('redacts database credentials from unexpected failures', async () => {
  loadDataIntelligence.mockRejectedValue(new Error('postgres://private-password@private-host'));
  const response = await GET();
  expect(response.status).toBe(503);
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(JSON.stringify(await response.json())).not.toContain('private-password');
});
