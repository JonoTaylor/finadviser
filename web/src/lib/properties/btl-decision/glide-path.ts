import Decimal from 'decimal.js';

/**
 * Model the "sell now, ISA-glide the proceeds" alternative.
 *
 * Year 1:
 *   - Initial proceeds are deployed: up to the annual ISA cap (£20k
 *     per owner) goes into a Stocks & Shares ISA, the rest into a
 *     General Investment Account (GIA).
 *   - Both balances then grow at `equityReturnPct` for the rest of
 *     the year. The GIA additionally suffers `giaDragPct`, an
 *     approximation of dividend/CGT-within-allowance tax drag.
 *
 * Years 2+:
 *   - A bed-and-ISA-style transfer moves up to the annual ISA
 *     allowance from the GIA into the ISA each year (capped at the
 *     GIA balance available). This is the standard glide pattern for
 *     someone with cash above the year-1 ISA cap: drip-feed it into
 *     the tax shelter as fast as the rules allow.
 *   - Both balances then grow for the year.
 *
 * End-of-year balances are reported, consistent with how the Hold
 * path in `opportunity-cost.ts` reports year-end property + cash.
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

  let isaBalance = new Decimal(0);
  let giaBalance = new Decimal(0);
  const out: GlidePathYear[] = [];

  for (let year = 1; year <= inputs.yearsToProject; year++) {
    let isaContribution: Decimal;
    let giaContribution: Decimal;

    if (year === 1) {
      // Deploy the lump sum: ISA up to capacity, residual to GIA.
      isaContribution = Decimal.min(inputs.initialProceeds, annualIsaCapacity);
      giaContribution = inputs.initialProceeds.minus(isaContribution);
    } else {
      // Bed-and-ISA-style transfer: move up to the annual allowance
      // from the GIA into the ISA, capped at the available GIA
      // balance. The GIA reports a negative contribution (outflow).
      isaContribution = Decimal.min(annualIsaCapacity, giaBalance);
      giaContribution = isaContribution.negated();
    }

    isaBalance = isaBalance.plus(isaContribution);
    giaBalance = giaBalance.plus(giaContribution);

    // Year-end compounding. ISA grows tax-free; GIA grows at the
    // equity return less the configurable tax drag. Doing this AFTER
    // the contribution lines up with the Hold path's year-end
    // reporting in opportunity-cost.ts, so apples-to-apples year 1
    // shows growth on the deployed lump sum rather than zero.
    isaBalance = isaBalance.mul(growthMultiplier);
    giaBalance = giaBalance.mul(growthMultiplier).mul(giaDragMultiplier);

    out.push({
      yearIndex: year,
      isaContribution,
      isaBalance,
      giaContribution,
      giaBalance,
      totalBalance: isaBalance.plus(giaBalance),
    });
  }

  return out;
}
