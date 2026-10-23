import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ preview: vi.fn(), correct: vi.fn() }));
vi.mock('@/lib/properties/mortgage-payment-date-review', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/properties/mortgage-payment-date-review')>(),
  previewMortgagePaymentDateCorrection: mocks.preview, correctMortgagePaymentDate: mocks.correct,
}));
import { GET, PATCH } from './route';
import { MortgageDateCorrectionConflictError } from '@/lib/properties/mortgage-payment-date-review';

const input = { mortgageId: 11, journalId: 1, correctDate: '2026-08-28' };
const preview = { ...input, propertyId: 5, date: '2026-08-08', amount: '1861.22', expectedSnapshot: 'a'.repeat(32), canCorrect: true };
const context = { params: Promise.resolve({ id: '5' }) };
function save(body: unknown) {
  return PATCH(new NextRequest('http://localhost/api/properties/5/mortgages/payment-date-correction', {
    method: 'PATCH', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' },
  }), context);
}

describe('mortgage payment date correction endpoint', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.preview.mockResolvedValue(preview);
    mocks.correct.mockResolvedValue({ corrected: true, alreadyCorrected: false, record: { ...preview, date: input.correctDate } });
  });

  it('returns actual preview evidence with no caching or write', async () => {
    const result = await GET(new NextRequest('http://localhost/api/properties/5/mortgages/payment-date-correction?mortgageId=11&journalId=1&correctDate=2026-08-28'), context);
    expect(result.status).toBe(200);
    expect(result.headers.get('Cache-Control')).toContain('no-store');
    expect(mocks.preview).toHaveBeenCalledExactlyOnceWith({ ...input, propertyId: 5 });
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  it('requires explicit confirmation and the exact preview snapshot before writing', async () => {
    expect((await save({ ...input, expectedSnapshot: preview.expectedSnapshot })).status).toBe(400);
    expect((await save({ ...input, expectedSnapshot: 'wrong', confirmed: true })).status).toBe(400);
    expect((await save({ ...input, correctDate: '2026-02-30', expectedSnapshot: preview.expectedSnapshot, confirmed: true })).status).toBe(400);
    expect(mocks.correct).not.toHaveBeenCalled();
  });

  it('returns only a persisted correction result after explicit confirmation', async () => {
    const result = await save({ ...input, expectedSnapshot: preview.expectedSnapshot, confirmed: true });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ corrected: true, record: { date: '2026-08-28' } });
    expect(mocks.correct).toHaveBeenCalledExactlyOnceWith({ ...input, propertyId: 5, expectedSnapshot: preview.expectedSnapshot });
  });

  it('returns a conflict without retrying or claiming a stale edit was saved', async () => {
    mocks.correct.mockRejectedValue(new MortgageDateCorrectionConflictError());
    const result = await save({ ...input, expectedSnapshot: preview.expectedSnapshot, confirmed: true });
    expect(result.status).toBe(409);
    expect(await result.json()).not.toHaveProperty('corrected');
    expect(mocks.correct).toHaveBeenCalledTimes(1);
  });

  it('keeps private database failures out of responses', async () => {
    mocks.correct.mockRejectedValue(new Error('postgres://private-password@private-db'));
    const result = await save({ ...input, expectedSnapshot: preview.expectedSnapshot, confirmed: true });
    expect(result.status).toBe(503);
    expect(JSON.stringify(await result.json())).not.toContain('private-password');
  });
});
