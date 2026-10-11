import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ClientError, NotFoundError } from '@/lib/errors';

const getProfile = vi.fn();
const upsertProfile = vi.fn();
vi.mock('@/lib/repos', () => ({
  ownerTaxRepo: {
    getProfile: (...args: unknown[]) => getProfile(...args),
    upsertProfile: (...args: unknown[]) => upsertProfile(...args),
  },
}));

import { GET, PUT } from './route';

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const put = (id: string, body: unknown, query = '?year=2025-26') =>
  PUT(
    new NextRequest(`http://localhost/api/owners/${id}/tax-profile${query}`, {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    ctx(id),
  );

beforeEach(() => {
  getProfile.mockReset();
  upsertProfile.mockReset();
});

describe('GET /api/owners/[id]/tax-profile', () => {
  it('returns the profile for the requested year', async () => {
    getProfile.mockResolvedValue({ ownerId: 1, taxYear: '2025-26', saved: false });
    const res = await GET(new NextRequest('http://localhost/x?year=2025-26'), ctx('1'));
    expect(res.status).toBe(200);
    expect(getProfile).toHaveBeenCalledWith(1, '2025-26');
  });

  it('rejects a non-numeric owner id with 400', async () => {
    const res = await GET(new NextRequest('http://localhost/x'), ctx('abc'));
    expect(res.status).toBe(400);
  });

  it('maps NotFoundError to 404 and ClientError to 400', async () => {
    getProfile.mockRejectedValueOnce(new NotFoundError('Owner 9 not found'));
    const notFound = await GET(new NextRequest('http://localhost/x'), ctx('9'));
    expect(notFound.status).toBe(404);
    expect((await notFound.json()).error).toBe('Owner 9 not found');

    getProfile.mockRejectedValueOnce(new ClientError('Invalid tax year label: nope'));
    const bad = await GET(new NextRequest('http://localhost/x?year=nope'), ctx('1'));
    expect(bad.status).toBe(400);
  });

  it('maps unexpected errors to 500', async () => {
    getProfile.mockRejectedValueOnce(new Error('db down'));
    const res = await GET(new NextRequest('http://localhost/x'), ctx('1'));
    expect(res.status).toBe(500);
  });
});

describe('PUT /api/owners/[id]/tax-profile', () => {
  it('validates, normalises money, fills omitted fields with 0.00 and saves', async () => {
    upsertProfile.mockImplementation(async (_o, _y, input) => ({ ...input, saved: true }));
    const res = await put('1', { employmentIncome: 12570, dividends: '1500.5', notes: ' hi ' });
    expect(res.status).toBe(200);
    expect(upsertProfile).toHaveBeenCalledWith(1, '2025-26', {
      employmentIncome: '12570.00',
      payeTaxPaid: '0.00',
      selfEmploymentIncome: '0.00',
      savingsInterest: '0.00',
      dividends: '1500.50',
      otherIncome: '0.00',
      propertyLossesBroughtForward: '0.00',
      financeCostsBroughtForward: '0.00',
      notes: 'hi',
    });
  });

  it('rejects bad money with a 400 naming the field, and never calls the repo', async () => {
    const res = await put('1', { payeTaxPaid: -5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('payeTaxPaid');
    expect(upsertProfile).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and malformed JSON with 400', async () => {
    expect((await put('1', { salary: 1 })).status).toBe(400);
    const bad = await put('1', '{not json');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid JSON body');
  });

  it('maps a missing owner to 404', async () => {
    upsertProfile.mockRejectedValueOnce(new NotFoundError('Owner 9 not found'));
    expect((await put('9', {})).status).toBe(404);
  });
});
