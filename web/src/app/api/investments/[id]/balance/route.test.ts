import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClientError } from '@/lib/errors';
const mocks = vi.hoisted(() => ({ setBalance: vi.fn() }));
vi.mock('@/lib/properties/personal-net-worth', () => ({ setInvestmentBalance: mocks.setBalance }));
import { POST } from './route';

const post = (body: unknown, id = '1') => POST(new NextRequest('http://localhost/api/investments/1/balance', {
  method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body),
}), { params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-09-30T23:30:00Z'));
  mocks.setBalance.mockResolvedValue({ journalId: 1, delta: '1000.50', previousBalance: '0.00' });
});
afterEach(() => vi.useRealTimers());

describe('POST /api/investments/[id]/balance', () => {
  it('normalises a penny amount and defaults to the current London calendar date', async () => {
    const response = await post({ newBalance: ' 1000.5 ', description: ' Statement value ' });
    expect(response.status).toBe(200);
    expect(mocks.setBalance).toHaveBeenCalledWith({ accountId: 1, newBalance: '1000.50', asOfDate: '2026-10-01', description: 'Statement value' });
    expect(await response.json()).toMatchObject({ accountId: 1, asOfDate: '2026-10-01' });
  });

  it('rejects over-precision, nonfinite and excessive amounts, impossible dates and unknown fields', async () => {
    for (const body of [
      { newBalance: '1.234' }, { newBalance: 'NaN' }, { newBalance: '1000000000000' },
      { newBalance: '1000', asOfDate: '2026-02-30' }, { newBalance: '1000', asOfDate: '2025-02-29' },
      { newBalance: '1000', accountType: 'EXPENSE' }, { newBalance: 1000 },
    ]) expect((await post(body)).status).toBe(400);
    expect(mocks.setBalance).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs and JSON before calling the update wrapper', async () => {
    for (const id of ['1abc', '1.5', '-1', '0', '2147483648']) expect((await post({ newBalance: '1000' }, id)).status).toBe(400);
    expect((await post('{broken')).status).toBe(400);
    expect(mocks.setBalance).not.toHaveBeenCalled();
  });

  it('maps wrapper input errors to 400 without disclosing them as server failures', async () => {
    mocks.setBalance.mockRejectedValue(new ClientError('Invalid balance input'));
    expect((await post({ newBalance: '1000' })).status).toBe(400);
  });
});
