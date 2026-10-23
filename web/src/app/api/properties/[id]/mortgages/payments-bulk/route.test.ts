import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ mortgages: vi.fn(), account: vi.fn(), record: vi.fn() }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { getMortgages: mocks.mortgages } }));
vi.mock('@/lib/repos/account.repo', () => ({ accountRepo: { getById: mocks.account } }));
vi.mock('@/lib/properties/mortgage-tracker', () => ({ recordMortgagePayments: mocks.record }));
import { POST } from './route';
const body = { mortgageId: 3, payerOwnerId: 2, fromAccountId: 4, payments: [{ date: '2026-09-30', amount: '1861.22' }] };
function post(input: unknown, id = '8') {
  return POST(new NextRequest('http://localhost/api/properties/8/mortgages/payments-bulk', {
    method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' },
  }), { params: Promise.resolve({ id }) });
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.mortgages.mockResolvedValue([{ id: 3, interestOnly: true }]);
  mocks.account.mockResolvedValue({ id: 4, accountType: 'ASSET' });
  mocks.record.mockResolvedValue({ added: [{ journalId: 41, date: '2026-09-30', amount: '1861.22' }], duplicates: [], errors: [] });
});
describe('structured mortgage payment validation', () => {
  it('records the exact month-end date and returns persisted results', async () => {
    const response = await post(body);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ added: 1, details: { added: [{ date: '2026-09-30', amount: '1861.22' }] } });
    expect(mocks.record).toHaveBeenCalledExactlyOnceWith(body);
  });
  it.each([
    { date: '2026-02-31', amount: '10' }, { date: '2026-04-31', amount: '10' },
    { date: '2026-09-30', amount: '0' }, { date: '2026-09-30', amount: '10.001' },
    { date: '2026-09-30', amount: '10', principal: '11' },
  ])('rejects invalid dates and splits before any write: %j', async payment => {
    expect((await post({ ...body, payments: [payment] })).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('rejects malformed IDs, excessive batches and non-asset payment accounts', async () => {
    expect((await post(body, '8oops')).status).toBe(400);
    expect((await post({ ...body, payments: Array.from({ length: 101 }, () => body.payments[0]) })).status).toBe(400);
    mocks.account.mockResolvedValue({ accountType: 'LIABILITY' });
    expect((await post(body)).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('requires an explicit verified split for repayment mortgages', async () => {
    mocks.mortgages.mockResolvedValue([{ id: 3, interestOnly: false }]);
    expect((await post(body)).status).toBe(400);
    expect(mocks.record).not.toHaveBeenCalled();
    expect((await post({ ...body, payments: [{ ...body.payments[0], principal: '100' }] })).status).toBe(201);
  });
});
