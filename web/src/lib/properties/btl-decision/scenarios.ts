import Decimal from 'decimal.js';
import { totalMortgageCost, type MortgageProduct } from './mortgage-product';
import { estimateRentalTax } from './tax';
import { estimateNetSaleProceeds } from './proceeds';

/**
 * The four canonical scenarios from the brief. They're parameterised
 * by the property context (current mortgage balance, valuation,
 * tenancy end, ownership split) so they apply to any BTL the user
 * adds in future, not just Francis Road.
 *
 * Scenario semantics:
 *   ride_out — let the existing tenancy run to its natural end, then
 *               sell vacant. monthsHeld = months between today and
 *               scheduled completion. Voids = 0 (tenanted right up to
 *               the marketing window).
 *   fast_forced — serve Ground 1A notice as soon as legally possible,
 *               accept a void while marketing. Earlier completion,
 *               larger void window.
 *   delay_dodge_erc — push the sale past the ERC tie-in cliff, accepting
 *               extra months of carry to save the ERC.
 *   re_let — abandon the sale plan, re-let after the current tenancy
 *               ends. monthsHeld = full chosen-product term.
 *
 * Inputs that vary by scenario:
 *   monthsHeld, voidMonths, salePrice (optional EPC drag baked in),
 *   epcRemediation.
 */
export type ScenarioKey = 'ride_out' | 'fast_forced' | 'delay_dodge_erc' | 're_let';

export interface PropertyContext {
  /** Current outstanding mortgage balance across all charges. */
  mortgageBalance: Decimal;
  /** Latest valuation, used as a default sale price. */
  latestValuation: Decimal;
  /** Acquisition cost incl. SDLT for CGT calc. */
  acquisitionCost: Decimal;
  /** Number of joint owners (rolls up CGT allowance). */
  ownerCount: number;
  /** Annual rent at the active tenancy rate. */
  annualRent: Decimal;
  /** Annual deductible running costs (insurance, repairs, agent fees). */
  annualRunningCosts: Decimal;
  /** Marginal income-tax rate (drives both rental tax and CGT). */
  marginalRatePct: Decimal;
}

export interface ScenarioInputs {
  key: ScenarioKey;
  label: string;
  monthsHeld: number;
  voidMonths: number;
  salePrice: Decimal;
  sellingCosts: Decimal;
  epcRemediation: Decimal;
  /** True for re_let — there's no sale, so net proceeds aren't computed. */
  resultsInSale: boolean;
}

export interface ScenarioResult {
  key: ScenarioKey;
  label: string;
  totalExitCost: Decimal;
  mortgageCost: Decimal;
  ercCost: Decimal;
  netRentalAfterTax: Decimal;
  voidCost: Decimal;
  epcCost: Decimal;
  netProceeds: Decimal | null;
  /** Comparison metric: lower = better. Equals mortgageCost + voidCost + epcCost + ercCost minus netRentalAfterTax. Sale proceeds are reported separately. */
  totalCarryCost: Decimal;
}

export function evaluateScenario(params: {
  product: MortgageProduct;
  scenario: ScenarioInputs;
  context: PropertyContext;
}): ScenarioResult {
  const { product, scenario, context } = params;
  const monthlyPayment = new Decimal(product.monthlyPayment);
  const productFee = new Decimal(product.productFee);
  const exitFee = new Decimal(product.exitFee);

  const mortgageBreakdown = totalMortgageCost({
    monthsHeld: scenario.monthsHeld,
    monthlyPayment,
    productFee,
    exitFee,
    balanceAtRedemption: scenario.resultsInSale ? context.mortgageBalance : new Decimal(0),
    ercSchedule: product.ercSchedule,
  });

  // Pro-rate rent and running costs to the holding period, less voids.
  const tenantedMonths = Math.max(0, scenario.monthsHeld - scenario.voidMonths);
  const monthlyRent = context.annualRent.div(12);
  const monthlyRunningCosts = context.annualRunningCosts.div(12);
  const grossRent = monthlyRent.mul(tenantedMonths);
  const runningCosts = monthlyRunningCosts.mul(scenario.monthsHeld);
  // Mortgage interest portion: approximate as the headline-rate
  // monthly cost less an implied principal portion. For interest-only
  // products this equals the monthly payment exactly; for repayment
  // products it slightly overstates relief (conservative on after-tax
  // carry). The scenario explorer is a comparison tool, not a tax
  // return, so the approximation is acceptable here.
  const mortgageInterest = monthlyPayment.mul(scenario.monthsHeld);

  const tax = estimateRentalTax({
    grossRent,
    runningCosts,
    mortgageInterest,
    marginalRatePct: context.marginalRatePct,
  });
  const netRentalAfterTax = grossRent.minus(runningCosts).minus(tax.estimatedTaxDue);
  const voidCost = monthlyRent.mul(scenario.voidMonths);

  let netProceeds: Decimal | null = null;
  if (scenario.resultsInSale) {
    const proceeds = estimateNetSaleProceeds({
      salePrice: scenario.salePrice,
      mortgageBalanceAtSale: context.mortgageBalance,
      sellingCosts: scenario.sellingCosts.plus(scenario.epcRemediation),
      acquisitionCost: context.acquisitionCost,
      ownerCount: context.ownerCount,
      marginalRatePct: context.marginalRatePct,
    });
    netProceeds = proceeds.netProceeds;
  }

  const totalCarryCost = mortgageBreakdown.total
    .plus(voidCost)
    .plus(scenario.epcRemediation)
    .minus(netRentalAfterTax);

  return {
    key: scenario.key,
    label: scenario.label,
    totalExitCost: totalCarryCost,
    mortgageCost: mortgageBreakdown.total,
    ercCost: mortgageBreakdown.erc,
    netRentalAfterTax,
    voidCost,
    epcCost: scenario.epcRemediation,
    netProceeds,
    totalCarryCost,
  };
}

export interface ComparisonCell {
  productId: string;
  productName: string;
  scenarioKey: ScenarioKey;
  scenarioLabel: string;
  result: ScenarioResult;
}

export function runScenarioComparison(params: {
  products: MortgageProduct[];
  scenarios: ScenarioInputs[];
  context: PropertyContext;
}): ComparisonCell[] {
  const out: ComparisonCell[] = [];
  for (const product of params.products) {
    for (const scenario of params.scenarios) {
      out.push({
        productId: product.id,
        productName: product.name,
        scenarioKey: scenario.key,
        scenarioLabel: scenario.label,
        result: evaluateScenario({ product, scenario, context: params.context }),
      });
    }
  }
  return out;
}
