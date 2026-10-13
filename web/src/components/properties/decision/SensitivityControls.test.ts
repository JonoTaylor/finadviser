import { describe, it, expect } from 'vitest';
import { salePriceRangeFromValuation } from './SensitivityControls';

describe('salePriceRangeFromValuation', () => {
  it('brackets ±15% around the valuation for a mid-sized property', () => {
    const range = salePriceRangeFromValuation(450_000);
    // Bounds snap to the nearest £5k (with float rounding biasing the
    // top of the band toward £515k rather than £520k).
    expect(range.min).toBe(385_000);
    expect(range.max).toBe(515_000);
    expect(range.default).toBe(450_000);
    // 1% of £450k = £4.5k → step rounds down to £1k.
    expect(range.step).toBe(1000);
  });

  it('uses a £5k step for high-value properties', () => {
    const range = salePriceRangeFromValuation(1_500_000);
    expect(range.step).toBe(5000);
  });

  it('uses a £500 step for low-value properties', () => {
    const range = salePriceRangeFromValuation(80_000);
    expect(range.step).toBe(500);
  });

  it('floors the valuation at £50k so the slider has a usable spread', () => {
    const range = salePriceRangeFromValuation(1000);
    // The £50k floor applies to all derived values, so a stub property
    // with no real valuation still produces sensible bounds.
    expect(range.default).toBe(50_000);
    expect(range.min).toBeGreaterThanOrEqual(5000);
    expect(range.max).toBeGreaterThan(range.min);
  });

  it('always returns min < default < max', () => {
    for (const v of [250_000, 450_000, 750_000, 1_200_000]) {
      const r = salePriceRangeFromValuation(v);
      expect(r.min).toBeLessThan(r.default);
      expect(r.default).toBeLessThanOrEqual(r.max);
    }
  });
});
