import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { loadCategorizationActivity } from './activity';

beforeEach(() => vi.resetAllMocks());
describe('automatic spending activity across database drivers', () => {
  it('normalises raw Neon rows and suppresses legacy model confidence for an estimated category', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ standard: '0', estimated: '1', broad: '0' }] })
      .mockResolvedValueOnce({ rows: [{ journalId: 1, date: '2026-10-25', description: 'Synthetic card merchant', merchantName: 'Synthetic shop',
        categoryId: 2, categoryName: 'Shopping', assignmentKind: 'estimated', confidence: '0.8000', reason: 'Estimated retail category.',
        currency: null, amount: '-22.57', updatedAt: '2026-10-25 12:30:01.123456+00', evidence: null }] });
    const result = await loadCategorizationActivity();
    expect(result.counts).toEqual({ standard: 0, estimated: 1, broad: 0 });
    expect(result.items[0]).toMatchObject({ assignmentKind: 'estimated', confidence: null, amount: '-22.57', currency: null, updatedAt: '2026-10-25T12:30:01.123Z' });
  });
  it('does not claim an empty activity count if the coverage row cannot be read', async () => {
    mocks.execute.mockResolvedValue({ rows: [] });
    await expect(loadCategorizationActivity()).rejects.toThrow('coverage is unavailable');
  });
});
