import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ClientError, NotFoundError } from '@/lib/errors';

const getTaxComputation = vi.fn();
vi.mock('@/lib/repos', () => ({
  ownerTaxRepo: { getTaxComputation: (...args: unknown[]) => getTaxComputation(...args) },
}));

import { GET } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const get = (id: string, query = '?year=2025-26') =>
  GET(new NextRequest(`http://localhost/api/owners/${id}/tax-computation${query}`), ctx(id));

beforeEach(() => getTaxComputation.mockReset());

describe('GET /api/owners/[id]/tax-computation', () => {
  it('returns the computation for the owner and year', async () => {
    getTaxComputation.mockResolvedValue({ taxYear: '2025-26' });
    const res = await get('1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ taxYear: '2025-26' });
    expect(getTaxComputation).toHaveBeenCalledWith({ ownerId: 1, year: '2025-26' });
  });

  it('defaults to the current tax year when none is given', async () => {
    getTaxComputation.mockResolvedValue({});
    await get('1', '');
    expect(getTaxComputation.mock.calls[0][0].year).toMatch(/^\d{4}-\d{2}$/);
  });

  it('maps errors to 400 / 404 / 500', async () => {
    expect((await get('abc')).status).toBe(400);
    getTaxComputation.mockRejectedValueOnce(new ClientError('Invalid tax year label: x'));
    expect((await get('1', '?year=x')).status).toBe(400);
    getTaxComputation.mockRejectedValueOnce(new NotFoundError('Owner 9 not found'));
    expect((await get('9')).status).toBe(404);
    getTaxComputation.mockRejectedValueOnce(new Error('boom'));
    expect((await get('1')).status).toBe(500);
  });
});
