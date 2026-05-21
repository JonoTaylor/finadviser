import Decimal from 'decimal.js';
import {
  CGT_ANNUAL_ALLOWANCE,
  cgtRateForMarginalRate,
} from './tax';

/**
 * Net cash that lands in the seller's bank after a property sale.
 *
 * - `sellingCosts` covers agent + legal + EPC + any pre-sale works.
 * - `acquisitionCost` is the original purchase price PLUS any stamp
 *   duty and capital-improvement spend that's allowable against CGT.
 * - `ownerCount` rolls up CGT annual allowances for jointly owned
 *   properties (married couples / civil partners). For a sole owner
 *   pass 1; for a 50/50 joint sale pass 2.
 * - `marginalRatePct` drives the CGT rate via the 24%/18% split.
 */
export interface NetSaleProceedsInputs {
  salePrice: Decimal;
  mortgageBalanceAtSale: Decimal;
  sellingCosts: Decimal;
  acquisitionCost: Decimal;
  ownerCount: number;
  marginalRatePct: Decimal;
}

export interface NetSaleProceedsResult {
  grossProceeds: Decimal;
  gainBeforeAllowance: Decimal;
  allowanceUsed: Decimal;
  taxableGain: Decimal;
  cgtRatePct: Decimal;
  cgtDue: Decimal;
  netProceeds: Decimal;
}

export function estimateNetSaleProceeds(inputs: NetSaleProceedsInputs): NetSaleProceedsResult {
  const grossProceeds = inputs.salePrice
    .minus(inputs.mortgageBalanceAtSale)
    .minus(inputs.sellingCosts);
  const gainBeforeAllowance = inputs.salePrice
    .minus(inputs.acquisitionCost)
    .minus(inputs.sellingCosts);
  const allowanceUsed = CGT_ANNUAL_ALLOWANCE.mul(Math.max(1, inputs.ownerCount));
  const taxableGain = Decimal.max(gainBeforeAllowance.minus(allowanceUsed), 0);
  const cgtRatePct = cgtRateForMarginalRate(inputs.marginalRatePct);
  const cgtDue = taxableGain.mul(cgtRatePct).div(100);
  const netProceeds = grossProceeds.minus(cgtDue);
  return {
    grossProceeds,
    gainBeforeAllowance,
    allowanceUsed,
    taxableGain,
    cgtRatePct,
    cgtDue,
    netProceeds,
  };
}
