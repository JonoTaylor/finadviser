import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { ClientError, NotFoundError } from '@/lib/errors';

const getProfile = vi.fn();
const patchProfile = vi.fn();
vi.mock('@/lib/repos', () => ({
  ownerTaxRepo: {
    getProfile: (...args: unknown[]) => getProfile(...args),
    patchProfile: (...args: unknown[]) => patchProfile(...args),
  },
}));

import { GET, PUT, PATCH } from './route';
import { TaxProfileConflictError } from '@/lib/tax/profileFacts';

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
  patchProfile.mockReset();
  getProfile.mockResolvedValue({ revision: 3 });
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
  it('validates and normalises money while preserving omitted fields', async () => {
    patchProfile.mockImplementation(async (_o, _y, input) => ({ ...input, saved: true }));
    const res = await put('1', { expectedRevision: 3, employmentIncome: 12570, dividends: '1500.5', notes: ' hi ' });
    expect(res.status).toBe(200);
    expect(patchProfile).toHaveBeenCalledWith(1, '2025-26', {
      employmentIncome: '12570.00',
      dividends: '1500.50',
      notes: 'hi',
      expectedRevision: 3,
      source: 'user',
    });
  });

  it('rejects bad money with a 400 naming the field, and never calls the repo', async () => {
    const res = await put('1', { expectedRevision: 3, payeTaxPaid: -5 });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('payeTaxPaid');
    expect(patchProfile).not.toHaveBeenCalled();
  });

  it('rejects unknown fields and malformed JSON with 400', async () => {
    expect((await put('1', { salary: 1 })).status).toBe(400);
    const bad = await put('1', '{not json');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe('Invalid JSON body');
  });

  it('maps a missing owner to 404', async () => {
    patchProfile.mockRejectedValueOnce(new NotFoundError('Owner 9 not found'));
    expect((await put('9', { expectedRevision: 3, employmentIncome: 1 })).status).toBe(404);
  });
});

const patch = (id: string, body: unknown, query = '?year=2026-27') => PATCH(
  new NextRequest(`http://localhost/api/owners/${id}/tax-profile${query}`, {
    method: 'PATCH', body: typeof body === 'string' ? body : JSON.stringify(body),
  }), ctx(id),
);

describe('PATCH /api/owners/[id]/tax-profile', () => {
  it('saves only supplied values and keeps null unknown distinct from zero', async () => {
    patchProfile.mockResolvedValue({ revision: 5, knownFields: ['payeTaxPaid'] });
    const response = await patch('1', { expectedRevision: 4, employmentIncome: null, payeTaxPaid: 0,
      facts: { baseSalary: '95000', bonusPercent: '30', bonusIsEstimate: true, employeePensionPercent: 8, employerPensionPercent: 8 } });
    expect(response.status).toBe(200);
    expect(patchProfile).toHaveBeenCalledWith(1, '2026-27', {
      expectedRevision: 4, source: 'user', employmentIncome: null, payeTaxPaid: '0.00',
      facts: { baseSalary: '95000.00', bonusPercent: 30, bonusIsEstimate: true, employeePensionPercent: 8, employerPensionPercent: 8 },
    });
  });

  it.each(['1abc', '-1', '0', '1.5', '9007199254740993'])('rejects invalid owner %s', async id => {
    expect((await patch(id, { expectedRevision: 0, payeTaxPaid: 0 })).status).toBe(400);
    expect(patchProfile).not.toHaveBeenCalled();
  });

  it('requires an explicit year and expected revision before saving', async () => {
    expect((await patch('1', { expectedRevision: 0, payeTaxPaid: 0 }, '')).status).toBe(400);
    expect((await patch('1', { payeTaxPaid: 0 })).status).toBe(400);
    expect(patchProfile).not.toHaveBeenCalled();
  });

  it('rejects invalid bodies, empty patches, unknown fields and conflicting bonus forms', async () => {
    for (const body of ['{broken', { expectedRevision: 0 }, { expectedRevision: 0, salary: 1 },
      { expectedRevision: 0, facts: { bonusAmount: 100, bonusPercent: 30 } }]) {
      expect((await patch('1', body)).status).toBe(400);
    }
    expect(patchProfile).not.toHaveBeenCalled();
  });

  it('returns a conflict without claiming a save succeeded', async () => {
    patchProfile.mockRejectedValue(new TaxProfileConflictError());
    const response = await patch('1', { expectedRevision: 1, payeTaxPaid: 0 });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain('no changes have been written');
  });

  it('fixes browser provenance to user and maps missing owners', async () => {
    patchProfile.mockRejectedValueOnce(new NotFoundError('Owner 9 not found'));
    expect((await patch('9', { expectedRevision: 0, source: 'ai', payeTaxPaid: 0 })).status).toBe(404);
    expect(patchProfile).toHaveBeenCalledWith(9, '2026-27', { expectedRevision: 0, source: 'user', payeTaxPaid: '0.00' });
  });
});
