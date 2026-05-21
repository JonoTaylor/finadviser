import Decimal from 'decimal.js';

/**
 * A user-editable mortgage product candidate. The scenario explorer
 * lets a BTL owner enter multiple products at once for side-by-side
 * comparison. Persistence is deferred to PR-C; for now `id` is a
 * client-generated UUID and these objects live in React state.
 *
 * `ercSchedule` is an ordered list of percentage tiers that apply
 * sequentially from month 0 onwards. For example, the brief's BTR03
 * has no ERC (single tier of 0% covering the full term), while a
 * 2-year fix typically reads `[{ untilMonth: 12, pct: '3' },
 * { untilMonth: 24, pct: '2' }]` (3% in year 1, 2% in year 2, zero
 * thereafter — gaps imply 0).
 */
export type MortgageProductType = 'fixed' | 'discount' | 'variable' | 'tracker' | 'no_erc';

export interface ErcTier {
  /** Inclusive upper bound: this tier applies while monthsHeld <= untilMonth. */
  untilMonth: number;
  /** Percentage of outstanding balance charged when redeeming inside this tier. */
  pct: string;
}

export interface MortgageProduct {
  id: string;
  name: string;
  type: MortgageProductType;
  ratePct: string;
  productFee: string;
  exitFee: string;
  monthlyPayment: string;
  ercSchedule: ErcTier[];
}

/**
 * Look up the ERC percentage that applies if the mortgage is redeemed
 * after `monthsHeld` months. Tiers are scanned in order; the first
 * tier whose `untilMonth` is >= `monthsHeld` wins. If `monthsHeld`
 * exceeds the last tier the ERC is zero (the lender's tie-in has
 * expired).
 */
export function ercPctAt(monthsHeld: number, schedule: ErcTier[]): Decimal {
  if (monthsHeld < 0) return new Decimal(0);
  for (const tier of schedule) {
    if (monthsHeld <= tier.untilMonth) return new Decimal(tier.pct);
  }
  return new Decimal(0);
}

export function ercAmount(monthsHeld: number, balance: Decimal, schedule: ErcTier[]): Decimal {
  const pct = ercPctAt(monthsHeld, schedule);
  return balance.mul(pct).div(100);
}

export interface MortgageCostInputs {
  monthsHeld: number;
  monthlyPayment: Decimal;
  productFee: Decimal;
  exitFee: Decimal;
  balanceAtRedemption: Decimal;
  ercSchedule: ErcTier[];
}

export interface MortgageCostBreakdown {
  monthlyPaymentsTotal: Decimal;
  productFee: Decimal;
  exitFee: Decimal;
  erc: Decimal;
  total: Decimal;
}

/**
 * Total all-in mortgage cost over a holding period of `monthsHeld`,
 * combining monthly payments, fixed product/exit fees, and an early
 * repayment charge if redeeming inside the tie-in. This is a
 * deliberately simple model: it sums monthly payments at the headline
 * rate rather than re-deriving interest from an amortisation
 * schedule. For decision-support purposes (comparing products with
 * roughly the same balance) that simplification is fine; for a true
 * after-tax interest projection the caller should pair this with
 * `mortgage-interest.ts:computeInterestForRange`.
 */
export function totalMortgageCost(inputs: MortgageCostInputs): MortgageCostBreakdown {
  const monthlyPaymentsTotal = inputs.monthlyPayment.mul(inputs.monthsHeld);
  const erc = ercAmount(inputs.monthsHeld, inputs.balanceAtRedemption, inputs.ercSchedule);
  const total = monthlyPaymentsTotal.plus(inputs.productFee).plus(inputs.exitFee).plus(erc);
  return {
    monthlyPaymentsTotal,
    productFee: inputs.productFee,
    exitFee: inputs.exitFee,
    erc,
    total,
  };
}
