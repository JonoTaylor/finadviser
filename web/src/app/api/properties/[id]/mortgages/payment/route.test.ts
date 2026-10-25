import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getMortgage = vi.fn();
const recordMortgagePayment = vi.fn();
vi.mock('@/lib/repos', () => ({
  propertyRepo: { getMortgage: (...args: unknown[]) => getMortgage(...args) },
}));
vi.mock('@/lib/properties/mortgage-tracker', () => ({
  recordMortgagePayment: (...args: unknown[]) => recordMortgagePayment(...args),
}));

import { POST } from './route';

const valid = {
  mortgageId: 7, paymentDate: '2025-04-01', totalAmount: '850.00',
  principalAmount: '200', interestAmount: '650', payerOwnerId: 2, fromAccountId: 11,
};
const post = (body: unknown, propertyId = '3') => POST(
  new NextRequest(`http://localhost/api/properties/${propertyId}/mortgages/payment`, {
    method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
  }),
  { params: Promise.resolve({ id: propertyId }) },
);

beforeEach(() => {
  getMortgage.mockReset().mockResolvedValue({ id: 7, propertyId: 3 });
  recordMortgagePayment.mockReset().mockResolvedValue(501);
});

describe('POST /api/properties/[id]/mortgages/payment', () => {
  it('records a balanced payment against a mortgage on this property', async () => {
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ journalId: 501 });
    expect(recordMortgagePayment).toHaveBeenCalledWith(expect.objectContaining({
      mortgageId: 7, totalAmount: '850.00', principalAmount: '200.00', interestAmount: '650.00',
    }));
  });

  it('explains a principal and interest split that does not add up, before writing anything', async () => {
    const res = await post({ ...valid, interestAmount: '600' });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('must add up to the total amount (£850.00)');
    expect(recordMortgagePayment).not.toHaveBeenCalled();
  });

  it('refuses a mortgage that belongs to a different property', async () => {
    getMortgage.mockResolvedValue({ id: 7, propertyId: 99 });
    expect((await post(valid)).status).toBe(404);
    expect(recordMortgagePayment).not.toHaveBeenCalled();
  });

  it('rejects malformed input with 400 rather than a server error', async () => {
    for (const body of ['{oops', [], { ...valid, paymentDate: '2025-02-30' }, { ...valid, totalAmount: '-1' },
      { ...valid, mortgageId: 'seven' }, { ...valid, totalAmount: '0', principalAmount: '0', interestAmount: '0' }]) {
      expect((await post(body)).status).toBe(400);
    }
    expect((await post(valid, 'abc')).status).toBe(400);
    expect(recordMortgagePayment).not.toHaveBeenCalled();
  });
});
