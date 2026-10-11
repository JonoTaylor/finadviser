/**
 * Making Tax Digital for Income Tax Self Assessment (MTD ITSA) status.
 *
 * HMRC mandates MTD ITSA in phases. A person must join from the phase date
 * if their "qualifying income" in the matching earlier tax year was MORE
 * than the threshold:
 *
 *   2024-25 income > £50,000  ->  from 6 April 2026
 *   2025-26 income > £30,000  ->  from 6 April 2027
 *   2026-27 income > £20,000  ->  from 6 April 2028
 *
 * Qualifying income is gross self-employment (sole trader) plus gross
 * property receipts, before any expenses or allowances. Property receipts
 * here are the owner's share of rent, and include rent-a-room receipts
 * (HMRC counts letting furnished rooms in your own home as property
 * income). Dividends, savings, employment and pension income do not count.
 *
 * The thresholds live in taxRates.ts (MTD_ITSA_COHORTS).
 */

import Decimal from 'decimal.js';
import { formatCurrency } from '@/lib/utils/formatting';
import { nonNegativeMoney } from './moneyInput';
import { MTD_ITSA_COHORTS } from './taxRates';
import { parseTaxYearLabel, taxYearRange } from './ukTaxYear';

export type MtdItsaScope = 'in_scope' | 'below_threshold' | 'no_phase';

export interface MtdItsaStatus {
  taxYear: string;
  qualifyingIncome: string;
  propertyReceipts: string;
  selfEmploymentReceipts: string;
  /** Threshold this year's income is tested against; null when no phase uses this year. */
  threshold: string | null;
  /** First day MTD ITSA becomes mandatory if the test is met; null when no phase uses this year. */
  mandatoryFrom: string | null;
  /** Threshold minus qualifying income (negative when over); null when no threshold. */
  headroom: string | null;
  scope: MtdItsaScope;
  /**
   * True when this tax year is not one of the three announced test years,
   * so the lowest announced threshold is used as a rough guide only.
   */
  thresholdAssumed: boolean;
  summary: string;
}

export function computeMtdItsaStatus(params: {
  taxYear: string;
  propertyReceipts: Decimal.Value;
  selfEmploymentReceipts: Decimal.Value;
}): MtdItsaStatus {
  const startYear = parseTaxYearLabel(params.taxYear);
  const taxYear = taxYearRange(startYear).label;
  const property = nonNegativeMoney(params.propertyReceipts, 'Property receipts');
  const selfEmployment = nonNegativeMoney(params.selfEmploymentReceipts, 'Self-employment receipts');
  const qualifying = property.plus(selfEmployment);

  const base = {
    taxYear,
    qualifyingIncome: qualifying.toFixed(2),
    propertyReceipts: property.toFixed(2),
    selfEmploymentReceipts: selfEmployment.toFixed(2),
  };

  const cohort = MTD_ITSA_COHORTS.find(c => c.basedOnTaxYear === taxYear);
  const first = MTD_ITSA_COHORTS[0];
  const last = MTD_ITSA_COHORTS[MTD_ITSA_COHORTS.length - 1];

  // Years before the first phase never trigger mandation.
  if (!cohort && startYear < parseTaxYearLabel(first.basedOnTaxYear)) {
    return {
      ...base,
      threshold: null,
      mandatoryFrom: null,
      headroom: null,
      scope: 'no_phase',
      thresholdAssumed: false,
      summary: `Income for ${taxYear} is not used to decide MTD ITSA mandation (the first test year is ${first.basedOnTaxYear}).`,
    };
  }

  // Years after the last announced phase: no start date has been published,
  // so compare against the lowest announced threshold as a guide.
  const used = cohort ?? last;
  const assumed = !cohort;
  const over = qualifying.gt(used.threshold);
  const headroom = used.threshold.minus(qualifying);

  let summary: string;
  if (assumed) {
    summary =
      `No MTD ITSA phase has been announced for ${taxYear} income. For reference, qualifying income of ${formatCurrency(qualifying)} is ` +
      `${over ? 'above' : 'within'} the lowest announced threshold of ${formatCurrency(used.threshold)}.`;
  } else if (over) {
    summary =
      `Qualifying income of ${formatCurrency(qualifying)} is over the ${formatCurrency(used.threshold)} threshold for ${taxYear} income, ` +
      `so MTD ITSA is mandatory from ${used.mandatoryFrom}.`;
  } else {
    summary =
      `Qualifying income of ${formatCurrency(qualifying)} is within the ${formatCurrency(used.threshold)} threshold for ${taxYear} income ` +
      `(${formatCurrency(headroom)} to spare), so MTD ITSA is not triggered by this year (the ${used.mandatoryFrom} phase).`;
  }

  return {
    ...base,
    threshold: used.threshold.toFixed(2),
    mandatoryFrom: used.mandatoryFrom,
    headroom: headroom.toFixed(2),
    scope: over ? 'in_scope' : 'below_threshold',
    thresholdAssumed: assumed,
    summary,
  };
}
