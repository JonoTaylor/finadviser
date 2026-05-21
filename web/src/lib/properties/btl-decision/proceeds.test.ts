import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { estimateNetSaleProceeds } from './proceeds';

describe('estimateNetSaleProceeds', () => {
  it('taxes the whole gain at 24% for a higher-rate joint sale', () => {
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
    // CGT @ 24% (higher rate, no basic-band headroom): 18240
    // Net: 142000 - 18240 = 123760
    expect(result.grossProceeds.toString()).toBe('142000');
    expect(result.gainBeforeAllowance.toString()).toBe('82000');
    expect(result.allowanceUsed.toString()).toBe('6000');
    expect(result.taxableGain.toString()).toBe('76000');
    expect(result.cgtRatePct.toString()).toBe('24');
    expect(result.cgtTaxedAtBasic.toString()).toBe('0');
    expect(result.cgtTaxedAtHigher.toString()).toBe('76000');
    expect(result.cgtDue.toString()).toBe('18240');
    expect(result.netProceeds.toString()).toBe('123760');
  });

  it('defaults a basic-rate taxpayer with no declared headroom to the 24% higher rate', () => {
    // Realistic for most BTL sales — gain pushes through the band even
    // if the seller is nominally a basic-rate payer on income alone.
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(450000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(8000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 1,
      marginalRatePct: new Decimal(20),
    });
    expect(result.cgtRatePct.toString()).toBe('24');
    expect(result.cgtTaxedAtBasic.toString()).toBe('0');
  });

  it('splits the gain across 18%/24% bands when basic-rate headroom is declared', () => {
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(450000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(8000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 1,
      marginalRatePct: new Decimal(20),
      remainingBasicRateBandPerOwner: new Decimal(15000),
    });
    // Taxable gain: 450000 - 360000 - 8000 - 3000 = 79000
    // Band: 15000 at 18% = 2700
    // Rest: 64000 at 24% = 15360
    // CGT: 18060
    expect(result.taxableGain.toString()).toBe('79000');
    expect(result.cgtTaxedAtBasic.toString()).toBe('15000');
    expect(result.cgtTaxedAtHigher.toString()).toBe('64000');
    expect(result.cgtDue.toString()).toBe('18060');
  });

  it('ignores declared basic-band headroom for higher-rate taxpayers', () => {
    const result = estimateNetSaleProceeds({
      salePrice: new Decimal(450000),
      mortgageBalanceAtSale: new Decimal(300000),
      sellingCosts: new Decimal(8000),
      acquisitionCost: new Decimal(360000),
      ownerCount: 1,
      marginalRatePct: new Decimal(40),
      remainingBasicRateBandPerOwner: new Decimal(15000),
    });
    expect(result.cgtTaxedAtBasic.toString()).toBe('0');
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
    expect(result.cgtRatePct.toString()).toBe('0');
  });
});
