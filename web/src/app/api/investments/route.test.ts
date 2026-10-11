import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ accountRepo: {}, propertyRepo: {} }));
import { GET } from './route';

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
});
afterEach(() => vi.useRealTimers());

describe('GET /api/investments', () => {
  it('preserves record fields and adds the London calendar balance cutoff', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ id: 1, name: 'Pension', investment_kind: 'pension', owner_id: 2, owner_name: 'Owner', balance: '12500.00' }] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1, name: 'Pension', investmentKind: 'pension', ownerId: 2, ownerName: 'Owner', balance: '12500.00', balanceAsOf: '2026-10-01' }]);
  });

  it('keeps genuine empty investment lists separate from unavailable balance data', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [] });
    expect(await (await GET()).json()).toEqual([]);
    mocks.execute.mockRejectedValueOnce(new Error('Database unavailable'));
    const response = await GET();
    expect(response.status).toBe(500);
    expect(await response.json()).toHaveProperty('error');
  });
});
