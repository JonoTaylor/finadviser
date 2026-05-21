export type {
  MortgageProduct,
  MortgageProductType,
  ErcTier,
  MortgageCostInputs,
  MortgageCostBreakdown,
} from './mortgage-product';
export { ercPctAt, ercAmount, totalMortgageCost } from './mortgage-product';

export type { RentalTaxInputs, RentalTaxResult } from './tax';
export {
  estimateRentalTax,
  cgtRateForMarginalRate,
  CGT_RATE_BASIC_PCT,
  CGT_RATE_HIGHER_PCT,
  CGT_ANNUAL_ALLOWANCE,
} from './tax';

export type { NetSaleProceedsInputs, NetSaleProceedsResult } from './proceeds';
export { estimateNetSaleProceeds } from './proceeds';

export type {
  ScenarioKey,
  ScenarioInputs,
  ScenarioResult,
  PropertyContext,
  ComparisonCell,
} from './scenarios';
export { evaluateScenario, runScenarioComparison } from './scenarios';

export type {
  StackedCostSeries,
  BreakEvenSeries,
  BreakEvenSeriesPoint,
  DecisionMatrixCell,
  KeyInsight,
} from './chart-data';
export {
  buildStackedCostSeries,
  buildBreakEvenSeries,
  buildDecisionMatrix,
  buildKeyInsights,
} from './chart-data';

export type { GlidePathInputs, GlidePathYear } from './glide-path';
export { projectGlidePath } from './glide-path';

export type {
  OpportunityCostInputs,
  OpportunityCostYear,
  OpportunityCostResult,
} from './opportunity-cost';
export { projectOpportunityCost } from './opportunity-cost';
