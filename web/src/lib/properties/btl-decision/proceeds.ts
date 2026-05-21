import Decimal from 'decimal.js';
import {
  CGT_ANNUAL_ALLOWANCE,
  CGT_RATE_BASIC_PCT,
  CGT_RATE_HIGHER_PCT,
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
 * - `marginalRatePct` is the income-tax marginal rate. For CGT this
 *   determines whether the seller might have any basic-rate band
 *   headroom left (higher/additional rate payers don't).
 * - `remainingBasicRateBandPerOwner` (optional) is each owner's
 *   remaining basic-rate band in £. Residential-property gains are
 *   added to income; the portion within that headroom is taxed at 18%,
 *   the rest at 24%. Defaults to 0, which assumes the gain pushes
 *   straight into the higher bracket. For typical BTL sales (£50k+
 *   per-owner gains, modest existing income headroom) this is realistic;
 *   the field is there for callers that know the seller's exact income
 *   for the tax year.
 */
export interface NetSaleProceedsInputs {
  salePrice: Decimal;
  mortgageBalanceAtSale: Decimal;
  sellingCosts: Decimal;
  acquisitionCost: Decimal;
  ownerCount: number;
  marginalRatePct: Decimal;
  remainingBasicRateBandPerOwner?: Decimal;
}

export interface NetSaleProceedsResult {
  grossProceeds: Decimal;
  gainBeforeAllowance: Decimal;
  allowanceUsed: Decimal;
  taxableGain: Decimal;
  /** Blended effective CGT rate when the gain straddles the basic/higher boundary. */
  cgtRatePct: Decimal;
  cgtTaxedAtBasic: Decimal;
  cgtTaxedAtHigher: Decimal;
  cgtDue: Decimal;
  netProceeds: Decimal;
}

export function estimateNetSaleProceeds(inputs: NetSaleProceedsInputs): NetSaleProceedsResult {
  const ownerCount = Math.max(1, inputs.ownerCount);
  const grossProceeds = inputs.salePrice
    .minus(inputs.mortgageBalanceAtSale)
    .minus(inputs.sellingCosts);
  const gainBeforeAllowance = inputs.salePrice
    .minus(inputs.acquisitionCost)
    .minus(inputs.sellingCosts);
  const allowanceUsed = CGT_ANNUAL_ALLOWANCE.mul(ownerCount);
  const taxableGain = Decimal.max(gainBeforeAllowance.minus(allowanceUsed), 0);

  // Higher/additional-rate payers can't have basic-rate headroom; force
  // band to zero in that case regardless of what the caller passed.
  const bandPerOwner =
    inputs.marginalRatePct.gt(20)
      ? new Decimal(0)
      : (inputs.remainingBasicRateBandPerOwner ?? new Decimal(0));
  const totalBasicBand = bandPerOwner.mul(ownerCount);
  const taxedAtBasic = Decimal.min(taxableGain, totalBasicBand);
  const taxedAtHigher = taxableGain.minus(taxedAtBasic);
  const cgtDue = taxedAtBasic
    .mul(CGT_RATE_BASIC_PCT)
    .div(100)
    .plus(taxedAtHigher.mul(CGT_RATE_HIGHER_PCT).div(100));
  const cgtRatePct = taxableGain.gt(0)
    ? cgtDue.div(taxableGain).mul(100)
    : new Decimal(0);

  return {
    grossProceeds,
    gainBeforeAllowance,
    allowanceUsed,
    taxableGain,
    cgtRatePct,
    cgtTaxedAtBasic: taxedAtBasic,
    cgtTaxedAtHigher: taxedAtHigher,
    cgtDue,
    netProceeds: grossProceeds.minus(cgtDue),
  };
}
