import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import {
  buildStackedCostSeries,
  buildBreakEvenSeries,
  buildDecisionMatrix,
  buildKeyInsights,
} from './chart-data';
import { runScenarioComparison } from './scenarios';
import type { MortgageProduct } from './mortgage-product';
import type { PropertyContext, ScenarioInputs } from './scenarios';

const PRODUCT_NO_ERC: MortgageProduct = {
  id: 'btr03',
  name: 'BTR03',
  type: 'no_erc',
  ratePct: '5.49',
  productFee: '995',
  exitFee: '0',
  monthlyPayment: '2059',
  ercSchedule: [],
};

const PRODUCT_DISCOUNT: MortgageProduct = {
  id: 'bdr01',
  name: 'BDR01',
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

const SCENARIOS: ScenarioInputs[] = [
  {
    key: 'ride_out',
    label: 'Ride out',
    monthsHeld: 6,
    voidMonths: 1,
    salePrice: new Decimal(450000),
    sellingCosts: new Decimal(8000),
    epcRemediation: new Decimal(0),
    resultsInSale: true,
  },
  {
    key: 'fast_forced',
    label: 'Fast forced',
    monthsHeld: 4,
    voidMonths: 3,
    salePrice: new Decimal(425000),
    sellingCosts: new Decimal(8000),
    epcRemediation: new Decimal(0),
    resultsInSale: true,
  },
];

describe('buildStackedCostSeries', () => {
  it('picks the leading product per scenario and orders by ascending total carry', () => {
    const cells = runScenarioComparison({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      scenarios: SCENARIOS,
      context: CONTEXT,
    });
    const series = buildStackedCostSeries(cells);
    expect(series).toHaveLength(2);
    expect(series[0].total).toBeLessThanOrEqual(series[1].total);
    // BTR03 (no ERC) should lead at both short-hold scenarios.
    expect(series.every(s => s.productName === 'BTR03')).toBe(true);
  });
});

describe('buildBreakEvenSeries', () => {
  it('samples cumulative cost monthly with ERC reflected per tier', () => {
    const series = buildBreakEvenSeries(
      [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      new Decimal(300000),
      30,
    );
    expect(series).toHaveLength(2);
    expect(series[0].points).toHaveLength(31); // 0..30 inclusive
    // BDR01 month 0: monthly×0 + fee 1995 + exit 100 + ERC 300000×3%=9000 = 11095
    const bdr01 = series.find(s => s.productId === 'bdr01')!;
    expect(bdr01.points[0].cumulativeCost).toBe(11095);
    // BDR01 month 25 (post tie-in): payments+fee+exit, ERC=0.
    expect(bdr01.points[25].cumulativeCost).toBe(25 * 1871 + 1995 + 100);
    expect(bdr01.ercStepMonths).toEqual([12, 24]);
    // BTR03 ercStepMonths empty.
    const btr03 = series.find(s => s.productId === 'btr03')!;
    expect(btr03.ercStepMonths).toEqual([]);
  });
});

describe('buildDecisionMatrix', () => {
  it('picks the no-ERC product for low-timing-confidence cells', () => {
    const cells = runScenarioComparison({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      scenarios: SCENARIOS,
      context: CONTEXT,
    });
    const matrix = buildDecisionMatrix({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      cells,
    });
    expect(matrix).toHaveLength(9);
    const lowTimingCells = matrix.filter(m => m.timingConfidence === 'low');
    expect(lowTimingCells.every(m => m.recommendedProductId === 'btr03')).toBe(true);
  });

  it('picks the lowest monthly payment for high-confidence high-cooperation', () => {
    const cells = runScenarioComparison({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      scenarios: SCENARIOS,
      context: CONTEXT,
    });
    const matrix = buildDecisionMatrix({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      cells,
    });
    const sweetSpot = matrix.find(
      m => m.timingConfidence === 'high' && m.tenantCooperation === 'high',
    )!;
    // BDR01 has the lowest monthly payment (1871 vs 2059).
    expect(sweetSpot.recommendedProductId).toBe('bdr01');
  });
});

describe('buildKeyInsights', () => {
  it('produces one insight per scenario', () => {
    const cells = runScenarioComparison({
      products: [PRODUCT_NO_ERC, PRODUCT_DISCOUNT],
      scenarios: SCENARIOS,
      context: CONTEXT,
    });
    const insights = buildKeyInsights(cells);
    expect(insights).toHaveLength(2);
    expect(insights[0].message).toMatch(/Wins by £/);
  });
});
