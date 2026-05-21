import Decimal from 'decimal.js';

/**
 * Section 24 estimator factored out of `btl-profitability.ts` so the
 * existing per-tax-year `BtlDecisionCard` and the new scenario-explorer
 * tool share a single implementation. The legacy module continues to
 * own the bank-cash-flow / stress-tests / equity-return concerns; only
 * the tax-due maths lives here.
 *
 * Inputs are pre-aggregated annual figures; this function does not
 * touch the DB. Marginal-rate-aware: pass the BTL owner's effective
 * marginal income-tax rate (basic 20, higher 40, additional 45) and
 * the basic-rate relief assumption (HMRC fixes this at 20).
 */
export interface RentalTaxInputs {
  grossRent: Decimal;
  runningCosts: Decimal;
  mortgageInterest: Decimal;
  marginalRatePct: Decimal;
  reliefRatePct?: Decimal;
}

export interface RentalTaxResult {
  taxableProfitBeforeRelief: Decimal;
  incomeTaxBeforeRelief: Decimal;
  mortgageInterestRelief: Decimal;
  estimatedTaxDue: Decimal;
}

const DEFAULT_RELIEF_RATE_PCT = new Decimal(20);

export function estimateRentalTax(inputs: RentalTaxInputs): RentalTaxResult {
  const reliefRatePct = inputs.reliefRatePct ?? DEFAULT_RELIEF_RATE_PCT;
  const taxableProfitBeforeRelief = inputs.grossRent.minus(inputs.runningCosts);
  const taxableProfitFloored = Decimal.max(taxableProfitBeforeRelief, 0);
  const incomeTaxBeforeRelief = taxableProfitFloored.mul(inputs.marginalRatePct).div(100);
  const mortgageInterestRelief = inputs.mortgageInterest.mul(reliefRatePct).div(100);
  const estimatedTaxDue = Decimal.max(incomeTaxBeforeRelief.minus(mortgageInterestRelief), 0);
  return {
    taxableProfitBeforeRelief,
    incomeTaxBeforeRelief,
    mortgageInterestRelief,
    estimatedTaxDue,
  };
}

/**
 * The CGT rules differ from the income-tax marginal rate: as of the
 * 2024/25 tax year, residential property gains attract 24 percent for
 * higher/additional-rate payers and 18 percent for basic-rate payers.
 * Allowance is £3,000 per owner per year (2024/25 onwards).
 */
export const CGT_RATE_HIGHER_PCT = new Decimal(24);
export const CGT_RATE_BASIC_PCT = new Decimal(18);
export const CGT_ANNUAL_ALLOWANCE = new Decimal(3000);

export function cgtRateForMarginalRate(marginalRatePct: Decimal): Decimal {
  return marginalRatePct.lte(20) ? CGT_RATE_BASIC_PCT : CGT_RATE_HIGHER_PCT;
}
