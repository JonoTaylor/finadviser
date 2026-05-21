import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { ercPctAt, ercAmount, totalMortgageCost } from './mortgage-product';

describe('ercPctAt', () => {
  const schedule = [
    { untilMonth: 12, pct: '3' },
    { untilMonth: 24, pct: '2' },
  ];

  it('returns the year-1 tier inside the first 12 months', () => {
    expect(ercPctAt(0, schedule).toString()).toBe('3');
    expect(ercPctAt(6, schedule).toString()).toBe('3');
    expect(ercPctAt(12, schedule).toString()).toBe('3');
  });

  it('returns the year-2 tier between months 13 and 24', () => {
    expect(ercPctAt(13, schedule).toString()).toBe('2');
    expect(ercPctAt(24, schedule).toString()).toBe('2');
  });

  it('returns zero once the tie-in has expired', () => {
    expect(ercPctAt(25, schedule).toString()).toBe('0');
    expect(ercPctAt(60, schedule).toString()).toBe('0');
  });

  it('returns zero for a no-ERC product (empty schedule)', () => {
    expect(ercPctAt(6, []).toString()).toBe('0');
  });
});

describe('ercAmount', () => {
  it('applies the ERC tier percentage to the redemption balance', () => {
    // Brief's BDR01 (2yr fixed, 2-month payment ERC equivalent) modelled
    // as a 3% Y1 tier on a £450k balance → £13,500.
    const result = ercAmount(6, new Decimal(450000), [{ untilMonth: 12, pct: '3' }]);
    expect(result.toString()).toBe('13500');
  });
});

describe('totalMortgageCost', () => {
  it('sums monthly payments, fees and ERC across a year-1 redemption', () => {
    const result = totalMortgageCost({
      monthsHeld: 6,
      monthlyPayment: new Decimal(2000),
      productFee: new Decimal(1995),
      exitFee: new Decimal(100),
      balanceAtRedemption: new Decimal(450000),
      ercSchedule: [{ untilMonth: 12, pct: '3' }],
    });
    // Payments: 6 × 2000 = 12000
    // Fee: 1995
    // Exit: 100
    // ERC: 450000 × 3% = 13500
    // Total: 27595
    expect(result.monthlyPaymentsTotal.toString()).toBe('12000');
    expect(result.erc.toString()).toBe('13500');
    expect(result.total.toString()).toBe('27595');
  });

  it('skips ERC when the holding period extends past the tie-in', () => {
    const result = totalMortgageCost({
      monthsHeld: 36,
      monthlyPayment: new Decimal(2000),
      productFee: new Decimal(1995),
      exitFee: new Decimal(100),
      balanceAtRedemption: new Decimal(450000),
      ercSchedule: [
        { untilMonth: 12, pct: '3' },
        { untilMonth: 24, pct: '2' },
      ],
    });
    expect(result.erc.toString()).toBe('0');
    // 36 × 2000 + 1995 + 100 = 74095
    expect(result.total.toString()).toBe('74095');
  });

  it('omits ERC entirely for a no-ERC product like BTR03', () => {
    const result = totalMortgageCost({
      monthsHeld: 6,
      monthlyPayment: new Decimal(2100),
      productFee: new Decimal(995),
      exitFee: new Decimal(0),
      balanceAtRedemption: new Decimal(450000),
      ercSchedule: [],
    });
    expect(result.erc.toString()).toBe('0');
    expect(result.total.toString()).toBe('13595');
  });
});
