import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ properties: vi.fn(), mortgages: vi.fn(), ownership: vi.fn(), accounts: vi.fn(), record: vi.fn(), preview: vi.fn(), correct: vi.fn() }));
vi.mock('@/lib/repos', () => ({
  propertyRepo: { listProperties: mocks.properties, getMortgages: mocks.mortgages, getOwnership: mocks.ownership },
  accountRepo: { listAll: mocks.accounts }, journalRepo: {}, categoryRepo: {}, tipRepo: {}, budgetRepo: {}, savingsGoalRepo: {}, aiMemoryRepo: {}, ownerTaxRepo: {},
}));
vi.mock('@/lib/properties/mortgage-tracker', () => ({ recordMortgagePayments: mocks.record }));
vi.mock('@/lib/properties/mortgage-payment-date-review', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/properties/mortgage-payment-date-review')>(),
  previewMortgagePaymentDateCorrection: mocks.preview, correctMortgagePaymentDate: mocks.correct,
}));
import { executeTool } from './tools';
import { MortgageDateCorrectionConflictError } from '@/lib/properties/mortgage-payment-date-review';

const rows = [
  ['30/09/2026', '1861.22'], ['28/08/2026', '1861.22'], ['31/07/2026', '1382.36'],
  ['30/06/2026', '1382.36'], ['29/05/2026', '1382.36'], ['30/04/2026', '1382.36'],
  ['31/03/2026', '1382.36'], ['27/02/2026', '1382.36'], ['30/01/2026', '1382.36'],
];
const paste = rows.map(([date, amount]) => `${date} Receipt £${amount} Credit`).join('');
const input = { property_name: 'Fixture rental', payments_text: paste };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.properties.mockResolvedValue([{ id: 8, name: 'Fixture rental', address: null }]);
  mocks.mortgages.mockResolvedValue([{ id: 3, lender: 'Fixture lender', interestOnly: true }]);
  mocks.ownership.mockResolvedValue([{ owner_id: 2, owner_name: 'Fixture owner' }]);
  mocks.accounts.mockResolvedValue([{ id: 4, name: 'Payment account', accountType: 'ASSET' }]);
  mocks.record.mockResolvedValue({ added: [], duplicates: [], errors: [] });
});

describe('mortgage import through the adviser and real parser', () => {
  it('passes all nine exact statement dates into the recorder without truncating a day', async () => {
    const result = await executeTool('bulk_add_mortgage_payments', input);
    expect(mocks.record.mock.calls[0][0].payments).toEqual(rows.map(([date, amount]) => ({
      date: date.split('/').reverse().join('-'), amount,
    })));
    expect(result).toMatchObject({ mortgageId: 3, parsed: { valid: 9, unparsed: 0, validAmount: '13398.96' } });
  });
  it('accepts the four formerly rejected month-end payments and sums them exactly', async () => {
    mocks.record.mockResolvedValue({ added: rows.filter(([date]) => date.startsWith('30/')).map(([date, amount], index) => ({
      journalId: index + 1, date: date.split('/').reverse().join('-'), amount,
    })), duplicates: [], errors: [] });
    const result = await executeTool('bulk_add_mortgage_payments', { ...input,
      payments_text: rows.filter(([date]) => date.startsWith('30/')).map(([date, amount]) => `${date} Receipt £${amount} Credit`).join('\n'),
    });
    expect(result).toMatchObject({ parsed: { valid: 4, unparsed: 0, validAmount: '6008.30' },
      booked: { added: 4, addedAmount: '6008.30', duplicateAmount: '0.00', unbookedAmount: '0.00' } });
    expect(mocks.record.mock.calls[0][0].payments.map((payment: { date: string }) => payment.date))
      .toEqual(['2026-09-30', '2026-06-30', '2026-04-30', '2026-01-30']);
  });
  it('returns the actual invalid-row reason without attempting to book it', async () => {
    const result = await executeTool('bulk_add_mortgage_payments', { ...input, payments_text: '31/09/2026 Receipt £1382.36 Credit' });
    expect(result).toMatchObject({ unparsed: 1, parseIssues: [{ reason: 'invalid_date' }] });
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('exposes actual legacy-review records without claiming a new booking or date correction', async () => {
    const error = { date: '2026-08-28', amount: '1861.22', code: 'possible_legacy_date', existingJournalId: 41, existingDate: '2026-08-08', message: 'Review earlier date' };
    mocks.record.mockResolvedValue({ added: [], duplicates: [], errors: [error] });
    expect(await executeTool('bulk_add_mortgage_payments', input)).toMatchObject({
      booked: { added: 0, errors: 1 }, details: { errors: [error] },
    });
    expect(mocks.correct).not.toHaveBeenCalled();
  });
  it('does not book a repayment loan as fully interest or exceed the bounded import', async () => {
    mocks.mortgages.mockResolvedValue([{ id: 3, lender: 'Lender', interestOnly: false }]);
    expect(await executeTool('bulk_add_mortgage_payments', input)).toHaveProperty('error');
    expect(mocks.record).not.toHaveBeenCalled();
    mocks.mortgages.mockResolvedValue([{ id: 3, lender: 'Lender', interestOnly: true }]);
    expect(await executeTool('bulk_add_mortgage_payments', { ...input, payments_text: '30/09/2026 £10 Credit\n'.repeat(101) })).toHaveProperty('error');
    expect(mocks.record).not.toHaveBeenCalled();
  });
});

describe('confirmed mortgage date correction tools', () => {
  const choice = { mortgage_id: 3, journal_id: 41, correct_date: '2026-08-28' };
  it('reads the actual date review without changing any ledger entry', async () => {
    mocks.preview.mockResolvedValue({ journalId: 41, date: '2026-08-08', correctDate: '2026-08-28', amount: '1861.22', canCorrect: true, expectedSnapshot: 'a'.repeat(32) });
    expect(await executeTool('get_mortgage_payment_date_review', choice)).toMatchObject({ date: '2026-08-08', correctDate: '2026-08-28' });
    expect(mocks.correct).not.toHaveBeenCalled();
  });
  it('requires a real proposed date and a current snapshot before any correction', async () => {
    expect(await executeTool('get_mortgage_payment_date_review', { ...choice, correct_date: '2026-02-31' })).toHaveProperty('error');
    expect(await executeTool('correct_mortgage_payment_date', choice)).toHaveProperty('error');
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.correct).not.toHaveBeenCalled();
  });
  it('passes only the confirmed record, proposed date and snapshot to the guarded writer', async () => {
    mocks.correct.mockResolvedValue({ corrected: true, alreadyCorrected: false, record: { date: '2026-08-28' } });
    expect(await executeTool('correct_mortgage_payment_date', { ...choice, expected_snapshot: 'a'.repeat(32) })).toMatchObject({ corrected: true, record: { date: '2026-08-28' } });
    expect(mocks.correct).toHaveBeenCalledExactlyOnceWith({ mortgageId: 3, journalId: 41, correctDate: '2026-08-28', expectedSnapshot: 'a'.repeat(32) });
    expect(mocks.record).not.toHaveBeenCalled();
  });
  it('reports a stale review as a conflict without claiming the date was saved', async () => {
    mocks.correct.mockRejectedValue(new MortgageDateCorrectionConflictError());
    const result = await executeTool('correct_mortgage_payment_date', { ...choice, expected_snapshot: 'a'.repeat(32) });
    expect(result).toMatchObject({ status: 'conflict' });
    expect(result).not.toHaveProperty('corrected');
    expect(mocks.correct).toHaveBeenCalledTimes(1);
  });
});
