import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { estimateRentalTax } from './tax';

describe('estimateRentalTax', () => {
  it('computes tax due net of basic-rate mortgage-interest relief at the higher rate', () => {
    const result = estimateRentalTax({
      grossRent: new Decimal(24000),
      runningCosts: new Decimal(4000),
      mortgageInterest: new Decimal(10000),
      marginalRatePct: new Decimal(40),
    });
    // Taxable profit before relief: 24000 - 4000 = 20000
    // Tax @ 40%: 8000
    // Relief: 10000 × 20% = 2000
    // Due: 8000 - 2000 = 6000
    expect(result.taxableProfitBeforeRelief.toString()).toBe('20000');
    expect(result.incomeTaxBeforeRelief.toString()).toBe('8000');
    expect(result.mortgageInterestRelief.toString()).toBe('2000');
    expect(result.estimatedTaxDue.toString()).toBe('6000');
  });

  it('floors taxable profit at zero when running costs exceed rent', () => {
    const result = estimateRentalTax({
      grossRent: new Decimal(10000),
      runningCosts: new Decimal(15000),
      mortgageInterest: new Decimal(8000),
      marginalRatePct: new Decimal(40),
    });
    expect(result.incomeTaxBeforeRelief.toString()).toBe('0');
    // Relief still calculated but tax due can't go negative.
    expect(result.estimatedTaxDue.toString()).toBe('0');
  });

  it('floors estimated tax due at zero when relief exceeds tax', () => {
    const result = estimateRentalTax({
      grossRent: new Decimal(15000),
      runningCosts: new Decimal(2000),
      mortgageInterest: new Decimal(20000), // huge relief
      marginalRatePct: new Decimal(20),
    });
    // Tax: 13000 × 20% = 2600
    // Relief: 20000 × 20% = 4000
    // Due: max(2600 - 4000, 0) = 0
    expect(result.estimatedTaxDue.toString()).toBe('0');
  });
});

