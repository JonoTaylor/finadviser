import Decimal from 'decimal.js';

/**
 * Model the "sell now, ISA-glide the proceeds" alternative.
 *
 * Each year:
 *   - Up to £20,000 per owner can go into a Stocks & Shares ISA
 *     (tax-free growth, tax-free withdrawal).
 *   - Anything above the ISA capacity sits in a General Investment
 *     Account (GIA), where dividends + realised gains attract tax.
 *   - Both pots compound at `equityReturnPct`; the GIA additionally
 *     suffers a `giaDragPct` drag each year that approximates the
 *     income/dividend tax + CGT-within-allowance tax drag.
 *
 * Annual ISA allowance of £20k/owner is the current UK rule (2024/25).
 */
export interface GlidePathInputs {
  initialProceeds: Decimal;
  equityReturnPct: Decimal;
  ownerCount: number;
  yearsToProject: number;
  giaDragPct?: Decimal;
}

export interface GlidePathYear {
  yearIndex: number;
  isaContribution: Decimal;
  isaBalance: Decimal;
  giaContribution: Decimal;
  giaBalance: Decimal;
  totalBalance: Decimal;
}

const ANNUAL_ISA_ALLOWANCE_PER_OWNER = new Decimal(20000);
const DEFAULT_GIA_DRAG_PCT = new Decimal('0.5');

export function projectGlidePath(inputs: GlidePathInputs): GlidePathYear[] {
  const annualIsaCapacity = ANNUAL_ISA_ALLOWANCE_PER_OWNER.mul(Math.max(1, inputs.ownerCount));
  const giaDragPct = inputs.giaDragPct ?? DEFAULT_GIA_DRAG_PCT;
  const growthMultiplier = inputs.equityReturnPct.div(100).plus(1);
  const giaDragMultiplier = new Decimal(1).minus(giaDragPct.div(100));

  let cashAwaitingDeployment = inputs.initialProceeds;
  let isaBalance = new Decimal(0);
  let giaBalance = new Decimal(0);
  const out: GlidePathYear[] = [];

  for (let year = 1; year <= inputs.yearsToProject; year++) {
    // Grow existing balances first.
    isaBalance = isaBalance.mul(growthMultiplier);
    giaBalance = giaBalance.mul(growthMultiplier).mul(giaDragMultiplier);

    // Then deploy this year's contributions: ISA up to capacity, rest to GIA.
    const isaContribution = Decimal.min(cashAwaitingDeployment, annualIsaCapacity);
    cashAwaitingDeployment = cashAwaitingDeployment.minus(isaContribution);
    isaBalance = isaBalance.plus(isaContribution);

    const giaContribution = cashAwaitingDeployment;
    cashAwaitingDeployment = new Decimal(0);
    giaBalance = giaBalance.plus(giaContribution);

    out.push({
      yearIndex: year,
      isaContribution,
      isaBalance,
      giaContribution,
      giaBalance,
      totalBalance: isaBalance.plus(giaBalance),
    });

    // Once the principal is deployed in Y1, subsequent years deploy
    // zero. The model assumes no additional savings flow in (a
    // user-tunable savings stream could be added later).
    cashAwaitingDeployment = new Decimal(0);
  }

  return out;
}
