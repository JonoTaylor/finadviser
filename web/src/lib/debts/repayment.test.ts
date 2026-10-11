import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { analyzeDebtRepayment, compareDebtRepayment, monthlyPaymentDate } from './repayment';
import { type ResolvedDebt } from './types';

const debt = (patch: Partial<ResolvedDebt> = {}): ResolvedDebt => ({
  id: 'bd737711-7f63-4e66-9d1b-00c94078801a', name: 'Card', accountId: null, ownerId: null,
  statementBalance: '1000.00', statementAsOf: '2026-01-31', apr: '0', minimumPayment: '25.00',
  priority: false, inArrears: false, promotionalApr: null, promotionalExpiresOn: null,
  paymentRestrictions: '', feeNotes: '', effectiveBalance: '1000.00', balanceAsOf: '2026-01-31',
  balanceSource: 'statement', accountName: null, sourceWarning: null, ...patch,
});
const analyze = (debts = [debt()], monthlyBudget = '300', asOf = '2026-01-31') => analyzeDebtRepayment({ debts, monthlyBudget, asOf, strategy: 'avalanche' });

describe('calendar repayment illustration', () => {
  it('caps the final payment and preserves the original payment day', () => {
    const result = analyze();
    expect(result).toMatchObject({ status: 'paid_off', months: 4, payoffDate: '2026-05-31', totalInterest: '0.00', totalPaid: '1000.00' });
    expect(result.schedule.map(month => [month.date, month.payment])).toEqual([
      ['2026-02-28', '300.00'], ['2026-03-31', '300.00'], ['2026-04-30', '300.00'], ['2026-05-31', '100.00'],
    ]);
  });
  it('handles leap days without date drift', () => {
    expect(monthlyPaymentDate('2028-01-31', 1)).toBe('2028-02-29');
    expect(monthlyPaymentDate('2028-01-31', 2)).toBe('2028-03-31');
    expect(monthlyPaymentDate('2028-02-29', 12)).toBe('2029-02-28');
  });
  it('splits promotional expiry at its actual day', () => {
    const result = analyze([debt({ apr: '36.5', promotionalApr: '0', promotionalExpiresOn: '2026-02-15' })], '1000');
    // £1/day for 13 days (15–28 February), then a small March remainder.
    expect(result.schedule[0].interest).toBe('13.00');
    expect(result.schedule[0].closingBalance).toBe('13.00');
    expect(result.schedule[1].payment).toBe('13.40');
    expect(result.totalInterest).toBe('13.40');
  });
  it('applies the standard rate from expiry including an expiry at period start', () => {
    const result = analyze([debt({ apr: '36.5', promotionalApr: '0', promotionalExpiresOn: '2026-01-31' })], '2000');
    expect(result.schedule[0].interest).toBe('28.00');
    expect(result.schedule[0].payment).toBe('1028.00');
  });
  it('does not assume unknown terms are zero', () => {
    const result = analyze([debt({ apr: null, minimumPayment: null })]);
    expect(result.status).toBe('incomplete');
    expect(result.missingInputs).toEqual(['Card: standard APR is unknown', 'Card: minimum repayment is unknown']);
    expect(result.payoffDate).toBeNull();
    expect(result.schedule).toEqual([]);
  });
  it('treats a missing linked balance as incomplete', () => {
    expect(analyze([debt({ effectiveBalance: null })]).status).toBe('incomplete');
  });
  it('does not include paid-off or ledger-credit balances', () => {
    const result = analyze([debt({ effectiveBalance: '0.00', apr: null, minimumPayment: null })]);
    expect(result).toMatchObject({ status: 'paid_off', months: 0, totalPaid: '0.00', totalInterest: '0.00' });
  });
  it('blocks the timeline for arrears and unmodelled restrictions', () => {
    expect(analyze([debt({ inArrears: true })])).toMatchObject({ status: 'attention_required', payoffDate: null });
    expect(analyze([debt({ feeNotes: 'Exit fee applies' })])).toMatchObject({ status: 'incomplete', payoffDate: null });
  });
  it('flags insufficient minimums before producing a payoff promise', () => {
    const result = analyze([debt({ minimumPayment: '200.00' })], '199.99');
    expect(result).toMatchObject({ status: 'insufficient_budget', requiredMinimum: '200.00', payoffDate: null, totalInterest: null });
  });
  it('allows a final month below the contractual minimum if the balance is smaller', () => {
    const result = analyze([debt({ effectiveBalance: '5.00', minimumPayment: '30.00' })], '10');
    expect(result).toMatchObject({ status: 'paid_off', totalPaid: '5.00', requiredMinimum: '5.00' });
  });
  it('warns when interest absorbs all payments', () => {
    const result = analyze([debt({ apr: '36.5', minimumPayment: '1.00' })], '20');
    expect(result).toMatchObject({ status: 'negative_amortization', payoffDate: null, totalInterest: null });
    expect(result.schedule[0].closingBalance).toBe('1008.00');
    expect(result.schedule).toHaveLength(600);
    expect(result.warnings.join(' ')).toContain('No payoff was reached within this horizon');
  });
  it('does not mistake a long calendar month for permanent negative amortisation', () => {
    const result = analyze([debt({ apr: '36.5', minimumPayment: '0.00', effectiveBalance: '1000.00' })], '30.90', '2026-07-31');
    expect(result.schedule[0].closingBalance).toBe('1000.10');
    expect(result.status).toBe('paid_off');
    expect(result.warnings.join(' ')).toContain('temporarily rise');
  });
  it('returns no payoff date at the timeline cap', () => {
    const result = analyzeDebtRepayment({ debts: [debt({ minimumPayment: '0.00' })], monthlyBudget: '1', asOf: '2026-01-31', strategy: 'avalanche', maxMonths: 3 });
    expect(result).toMatchObject({ status: 'timeline_limit', months: null, payoffDate: null });
    expect(result.schedule).toHaveLength(3);
  });
  it('pays every minimum then follows the selected order', () => {
    const high = debt({ name: 'Expensive', apr: '30', effectiveBalance: '2000.00', minimumPayment: '50.00' });
    const small = debt({ id: 'd3fa92cd-4d57-4194-8218-dc93ac995cd4', name: 'Small', apr: '5', effectiveBalance: '300.00', minimumPayment: '20.00' });
    const result = compareDebtRepayment({ debts: [high, small], monthlyBudget: '300', asOf: '2026-01-31' });
    expect(result.avalanche.schedule[0].payments.map(payment => payment.amount)).toEqual(['280.00', '20.00']);
    expect(result.snowball.schedule[0].payments.map(payment => payment.amount)).toEqual(['50.00', '250.00']);
    expect(new Decimal(result.avalanche.totalInterest!).lt(result.snowball.totalInterest!)).toBe(true);
  });
  it('places priority debt before either optimization strategy', () => {
    const priority = debt({ priority: true, name: 'Essential', apr: '0', effectiveBalance: '2000.00' });
    const small = debt({ id: 'd3fa92cd-4d57-4194-8218-dc93ac995cd4', apr: '50', effectiveBalance: '100.00' });
    const result = compareDebtRepayment({ debts: [priority, small], monthlyBudget: '200', asOf: '2026-01-31' });
    expect(result.avalanche.schedule[0].payments.map(payment => payment.amount)).toEqual(['175.00', '25.00']);
    expect(result.snowball.schedule[0].payments.map(payment => payment.amount)).toEqual(['175.00', '25.00']);
  });
  it('continues when priority repayments shrink a debt despite temporary total growth', () => {
    const priority = debt({ name: 'Priority', priority: true, apr: '100', minimumPayment: '0.00' });
    const other = debt({ id: 'd3fa92cd-4d57-4194-8218-dc93ac995cd4', name: 'Other', apr: '30', minimumPayment: '0.00' });
    const result = compareDebtRepayment({ debts: [priority, other], monthlyBudget: '100', asOf: '2026-01-01' });
    for (const illustration of [result.avalanche, result.snowball]) {
      expect(illustration.schedule[11].closingBalance).toBe('2018.07');
      expect(illustration.schedule[11].payments.find(payment => payment.name === 'Priority')?.remaining).toBe('673.19');
      expect(illustration.schedule[11].payments.find(payment => payment.name === 'Other')?.remaining).toBe('1344.88');
      expect(illustration).toMatchObject({ status: 'paid_off', months: 46, payoffDate: '2029-11-01' });
      expect(illustration.schedule.at(-1)?.closingBalance).toBe('0.00');
      expect(new Decimal(illustration.startingBalance).plus(illustration.totalInterest!).toFixed(2)).toBe(illustration.totalPaid);
      expect(illustration.warnings.join(' ')).toContain('temporarily rise');
    }
  });
  it('reconciles every month and never pays more than the budget', () => {
    const result = analyze([debt({ apr: '19.95', effectiveBalance: '2364.18' })], '173.25');
    expect(result.status).toBe('paid_off');
    for (const month of result.schedule) {
      expect(new Decimal(month.openingBalance).plus(month.interest).minus(month.payment).toFixed(2)).toBe(month.closingBalance);
      expect(new Decimal(month.payment).lte('173.25')).toBe(true);
      expect(new Decimal(month.closingBalance).gte(0)).toBe(true);
    }
    expect(new Decimal(result.startingBalance).plus(result.totalInterest!).toFixed(2)).toBe(result.totalPaid);
  });
  it.each(['-1', 'NaN', '1.001', '1e3'])('rejects invalid monthly budget %s', monthlyBudget => {
    expect(() => analyze(undefined, monthlyBudget)).toThrow();
  });
});
