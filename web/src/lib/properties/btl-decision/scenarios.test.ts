import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { evaluateScenario, runScenarioComparison } from './scenarios';
import type { MortgageProduct } from './mortgage-product';
import type { ScenarioInputs, PropertyContext } from './scenarios';

const BTR03_NO_ERC: MortgageProduct = {
  id: 'btr03',
  name: 'BTR03 (no ERC tracker)',
  type: 'no_erc',
  ratePct: '5.49',
  productFee: '995',
  exitFee: '0',
  monthlyPayment: '2059',
  ercSchedule: [],
};

const BDR01_DISCOUNT: MortgageProduct = {
  id: 'bdr01',
  name: 'BDR01 (2yr discount)',
  type: 'discount',
  ratePct: '4.99',
  productFee: '1995',
  exitFee: '100',
  monthlyPayment: '1871',
  ercSchedule: [
    { untilMonth: 12, pct: '3' },
    { untilMonth: 24, pct: '2' },
  ],
};

const CONTEXT: PropertyContext = {
  mortgageBalance: new Decimal(300000),
  latestValuation: new Decimal(450000),
  acquisitionCost: new Decimal(360000),
  ownerCount: 2,
  annualRent: new Decimal(24000),
  annualRunningCosts: new Decimal(3600),
  marginalRatePct: new Decimal(40),
};

const RIDE_OUT_6M: ScenarioInputs = {
  key: 'ride_out',
  label: 'Ride out tenancy',
  monthsHeld: 6,
  voidMonths: 1,
  salePrice: new Decimal(450000),
  sellingCosts: new Decimal(8000),
  epcRemediation: new Decimal(0),
  resultsInSale: true,
};

describe('evaluateScenario', () => {
  it('produces a sale-included result for the ride_out scenario × BTR03', () => {
    const result = evaluateScenario({
      product: BTR03_NO_ERC,
      scenario: RIDE_OUT_6M,
      context: CONTEXT,
    });
    // mortgage: 6 × 2059 + 995 + 0 + 0 = 13349
    expect(result.mortgageCost.toString()).toBe('13349');
    expect(result.ercCost.toString()).toBe('0');
    // void cost: 1 month × (24000/12) = 2000
    expect(result.voidCost.toString()).toBe('2000');
    expect(result.netProceeds).not.toBeNull();
  });

  it('charges Y1 ERC for a discount product redeemed inside 12 months', () => {
    const result = evaluateScenario({
      product: BDR01_DISCOUNT,
      scenario: RIDE_OUT_6M,
      context: CONTEXT,
    });
    // ERC: 300000 × 3% = 9000
    expect(result.ercCost.toString()).toBe('9000');
  });

  it('skips proceeds for a re_let scenario (no sale)', () => {
    const reLet: ScenarioInputs = {
      key: 're_let',
      label: 'Re-let',
      monthsHeld: 24,
      voidMonths: 1,
      salePrice: new Decimal(0),
      sellingCosts: new Decimal(0),
      epcRemediation: new Decimal(0),
      resultsInSale: false,
    };
    const result = evaluateScenario({
      product: BTR03_NO_ERC,
      scenario: reLet,
      context: CONTEXT,
    });
    expect(result.netProceeds).toBeNull();
  });

  it("ranks BTR03 ahead of BDR01 on total carry cost for an early sale (brief's leading plan)", () => {
    const a = evaluateScenario({ product: BTR03_NO_ERC, scenario: RIDE_OUT_6M, context: CONTEXT });
    const b = evaluateScenario({ product: BDR01_DISCOUNT, scenario: RIDE_OUT_6M, context: CONTEXT });
    expect(a.totalCarryCost.lessThan(b.totalCarryCost)).toBe(true);
  });
});

describe('runScenarioComparison', () => {
  it('produces N × M cells for N products and M scenarios', () => {
    const cells = runScenarioComparison({
      products: [BTR03_NO_ERC, BDR01_DISCOUNT],
      scenarios: [
        RIDE_OUT_6M,
        { ...RIDE_OUT_6M, key: 'fast_forced', label: 'Fast forced', monthsHeld: 4, voidMonths: 2 },
      ],
      context: CONTEXT,
    });
    expect(cells).toHaveLength(4);
    const keys = new Set(cells.map(c => `${c.productId}:${c.scenarioKey}`));
    expect(keys.size).toBe(4);
  });
});
