import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { estimateNetSaleProceeds } from './proceeds';

describe('estimateNetSaleProceeds', () => {
  it('computes net proceeds with CGT for a joint higher-rate sale', () => {
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(450000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(8000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 2,
      marginalRatePct: new Decimal(40),
    });
    // Gross: 450000 - 300000 - 8000 = 142000
    // Gain: 450000 - 360000 - 8000 = 82000
    // Allowance: 2 × 3000 = 6000
    // Taxable gain: 76000
    // CGT @ 24%: 18240
    // Net: 142000 - 18240 = 123760
    expect(result.grossProceeds.toString()).toBe('142000');
    expect(result.gainBeforeAllowance.toString()).toBe('82000');
    expect(result.allowanceUsed.toString()).toBe('6000');
    expect(result.taxableGain.toString()).toBe('76000');
    expect(result.cgtRatePct.toString()).toBe('24');
    expect(result.cgtDue.toString()).toBe('18240');
    expect(result.netProceeds.toString()).toBe('123760');
  });

  it('uses the 18% basic rate for basic-rate taxpayers', () => {
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(450000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(8000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 1,
      marginalRatePct: new Decimal(20),
    });
    expect(result.cgtRatePct.toString()).toBe('18');
  });

  it('floors taxable gain at zero when allowance exceeds the gain', () => {
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(360000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(5000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 2,
      marginalRatePct: new Decimal(40),
    });
    expect(result.taxableGain.toString()).toBe('0');
    expect(result.cgtDue.toString()).toBe('0');
  });
});
