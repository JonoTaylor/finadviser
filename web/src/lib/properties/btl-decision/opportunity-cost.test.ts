import { describe, it, expect } from 'vitest';
import Decimal from 'decimal.js';
import { projectOpportunityCost } from './opportunity-cost';

const BASE = {
  propertyValue: new Decimal(450000),
  mortgageBalance: new Decimal(300000),
  initialProceedsIfSold: new Decimal(130000),
  annualRent: new Decimal(24000),
  annualRunningCosts: new Decimal(3600),
  annualMortgageInterest: new Decimal(16000),
  marginalRatePct: new Decimal(40),
  ownerCount: 2,
  equityReturnPct: new Decimal(6),
  propertyGrowthPct: new Decimal(2),
  yearsToProject: 10,
};

describe('projectOpportunityCost', () => {
  it('produces one row per projection year', () => {
    const result = projectOpportunityCost(BASE);
    expect(result.years).toHaveLength(10);
    expect(result.years[0].yearIndex).toBe(1);
    expect(result.years[9].yearIndex).toBe(10);
  });

  it("flat property growth + flat rental cash flow lets sell-and-glide overtake hold over 10 years for the brief's higher-rate-taxpayer setup", () => {
    const result = projectOpportunityCost({
      ...BASE,
      propertyGrowthPct: new Decimal(0),
      equityReturnPct: new Decimal(7),
    });
    const finalYear = result.years[result.years.length - 1];
    expect(
      finalYear.sellAndGlide.netWealth.gt(finalYear.hold.netWealth),
    ).toBe(true);
  });

  it('higher property growth tips the comparison toward holding', () => {
    const result = projectOpportunityCost({
      ...BASE,
      propertyGrowthPct: new Decimal(8),
      equityReturnPct: new Decimal(4),
    });
    const finalYear = result.years[result.years.length - 1];
    expect(
      finalYear.hold.netWealth.gt(finalYear.sellAndGlide.netWealth),
    ).toBe(true);
  });
});
