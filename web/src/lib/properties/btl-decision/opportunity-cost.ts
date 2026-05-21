import Decimal from 'decimal.js';
import { estimateRentalTax } from './tax';
import { projectGlidePath, type GlidePathYear } from './glide-path';

/**
 * "Sell now, glide" vs "keep holding" net-wealth projection.
 *
 * Hold path:
 *   - Property grows at `propertyGrowthPct` per year.
 *   - Annual after-tax rental cash flow accumulates as a parallel
 *     cash balance (compounded at `equityReturnPct` to keep the
 *     comparison apples to apples — both paths get equity-market
 *     exposure on free cash).
 *   - Net wealth at year T = grown property value - mortgage
 *     balance (unchanged for interest-only) + accumulated cash.
 *
 * Sell-and-glide path:
 *   - Initial proceeds (sale price minus mortgage minus selling
 *     costs minus CGT) get fed into `projectGlidePath`.
 *   - Net wealth at year T = ISA balance + GIA balance.
 */
export interface OpportunityCostInputs {
  /** Today's valuation of the property. */
  propertyValue: Decimal;
  /** Today's outstanding mortgage balance. */
  mortgageBalance: Decimal;
  /** Net cash you'd receive if you sold today (after CGT). */
  initialProceedsIfSold: Decimal;
  /** Annual rent for the next 12 months. */
  annualRent: Decimal;
  /** Annual running costs ex-mortgage. */
  annualRunningCosts: Decimal;
  /** Annual mortgage interest charged. */
  annualMortgageInterest: Decimal;
  /** Marginal income tax rate. */
  marginalRatePct: Decimal;
  /** Owner count for ISA capacity rollup. */
  ownerCount: number;
  /** Equity market return assumption. */
  equityReturnPct: Decimal;
  /** Property capital growth assumption. */
  propertyGrowthPct: Decimal;
  /** Horizon for the comparison in years. */
  yearsToProject: number;
}

export interface OpportunityCostYear {
  yearIndex: number;
  hold: {
    propertyValue: Decimal;
    mortgageBalance: Decimal;
    cashReserve: Decimal;
    netWealth: Decimal;
  };
  sellAndGlide: {
    isaBalance: Decimal;
    giaBalance: Decimal;
    netWealth: Decimal;
  };
}

export interface OpportunityCostResult {
  years: OpportunityCostYear[];
  glideDetail: GlidePathYear[];
}

export function projectOpportunityCost(
  inputs: OpportunityCostInputs,
): OpportunityCostResult {
  const propertyGrowth = inputs.propertyGrowthPct.div(100).plus(1);
  const equityGrowth = inputs.equityReturnPct.div(100).plus(1);

  let propertyValue = inputs.propertyValue;
  let cashReserve = new Decimal(0);

  // Annual after-tax cash flow from holding the property. Section 24
  // captures the relief, plus running costs and mortgage interest are
  // both subtracted from the cash position.
  const tax = estimateRentalTax({
    grossRent: inputs.annualRent,
    runningCosts: inputs.annualRunningCosts,
    mortgageInterest: inputs.annualMortgageInterest,
    marginalRatePct: inputs.marginalRatePct,
  });
  const annualAfterTaxCashFlow = inputs.annualRent
    .minus(inputs.annualRunningCosts)
    .minus(inputs.annualMortgageInterest)
    .minus(tax.estimatedTaxDue);

  const glideDetail = projectGlidePath({
    initialProceeds: inputs.initialProceedsIfSold,
    equityReturnPct: inputs.equityReturnPct,
    ownerCount: inputs.ownerCount,
    yearsToProject: inputs.yearsToProject,
  });

  const years: OpportunityCostYear[] = [];
  for (let year = 1; year <= inputs.yearsToProject; year++) {
    // Hold path: property compounds, cash compounds, after-tax rental
    // gets added to the cash reserve at year end.
    propertyValue = propertyValue.mul(propertyGrowth);
    cashReserve = cashReserve.mul(equityGrowth).plus(annualAfterTaxCashFlow);
    const holdNetWealth = propertyValue.minus(inputs.mortgageBalance).plus(cashReserve);

    const glideYear = glideDetail[year - 1];
    const sellNetWealth = glideYear ? glideYear.totalBalance : new Decimal(0);

    years.push({
      yearIndex: year,
      hold: {
        propertyValue,
        mortgageBalance: inputs.mortgageBalance,
        cashReserve,
        netWealth: holdNetWealth,
      },
      sellAndGlide: {
        isaBalance: glideYear ? glideYear.isaBalance : new Decimal(0),
        giaBalance: glideYear ? glideYear.giaBalance : new Decimal(0),
        netWealth: sellNetWealth,
      },
    });
  }

  return { years, glideDetail };
}
