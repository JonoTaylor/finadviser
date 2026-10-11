/**
 * UK income-tax rates and allowances, keyed by tax year.
 *
 * SCOPE: rest-of-UK only (England, Wales and Northern Ireland). Scotland sets
 * its own non-savings, non-dividend bands and rates, so a Scottish taxpayer
 * would get the wrong answer here. Owners are assumed to be rUK taxpayers.
 *
 * All amounts are GBP; all `*Pct` values are percentages (20 means 20%).
 *
 * VERIFICATION: every figure below was checked against GOV.UK material via
 * web search on 2026-10-11 (the sandbox this was built in blocks direct
 * fetches of gov.uk, so the pages were read through search-result extracts,
 * not opened in full). The source URLs sit next to each year's table. A
 * year is marked `provisional` when any of its figures is announced but not
 * yet fixed in a Finance Act we could confirm, or is an assumption that the
 * current figure carries forward unchanged.
 */

import Decimal from 'decimal.js';
import { parseTaxYearLabel, taxYearRange } from './ukTaxYear';

const d = (v: string | number) => new Decimal(v);

/** One percentage per band. */
export interface RatePctSet {
  basic: Decimal;
  higher: Decimal;
  additional: Decimal;
}

export interface TaxRateTable {
  /** Label such as '2025-26'. */
  taxYear: string;
  startYear: number;
  /**
   * True when something in this table is announced-but-unlegislated or an
   * assumption that the previous year's figure carries forward. The UI
   * should flag the result as an estimate.
   */
  provisional: boolean;
  /** Human-readable reasons the table is provisional (empty otherwise). */
  provisionalNotes: string[];
  /** GOV.UK (and legislation.gov.uk) pages the figures come from. */
  sources: string[];

  personalAllowance: Decimal;
  /** Adjusted net income above this reduces the allowance by £1 per £2. */
  personalAllowanceTaperThreshold: Decimal;
  /** Width of the basic-rate band, in taxable income (after allowances). */
  basicRateLimit: Decimal;
  /** Taxable income above this is taxed at the additional rate. */
  additionalRateThreshold: Decimal;

  /** Employment, self-employment, pensions and other non-savings income. */
  nonSavingsRates: RatePctSet;
  /**
   * UK property profits. Identical to `nonSavingsRates` until 2027-28, when
   * property income gets its own, higher, rates.
   */
  propertyRates: RatePctSet;
  savingsRates: RatePctSet;
  dividendRates: RatePctSet;

  /** 0% band for savings, reduced £1-for-£1 by non-savings taxable income. */
  startingRateForSavingsLimit: Decimal;
  /** Personal savings allowance by the taxpayer's highest rate band. */
  personalSavingsAllowance: { basic: Decimal; higher: Decimal; additional: Decimal };
  dividendAllowance: Decimal;

  /** Trading/property allowance for gross property receipts. */
  propertyAllowance: Decimal;
  /**
   * Rent-a-room limit for one person for the whole tax year, across all their
   * lettings (HMRC PIM4010); halved when the letting is shared.
   */
  rentARoomLimit: Decimal;
  /**
   * Rate of the S.24 residential finance-cost tax reducer. The basic rate
   * for non-savings income until 2026-27; the 22% property basic rate from
   * 2027-28.
   */
  financeCostReliefRatePct: Decimal;
}

const BANDS_20_40_45: RatePctSet = { basic: d(20), higher: d(40), additional: d(45) };
const BANDS_22_42_47: RatePctSet = { basic: d(22), higher: d(42), additional: d(47) };
const DIVIDEND_2024_25: RatePctSet = { basic: d('8.75'), higher: d('33.75'), additional: d('39.35') };
const DIVIDEND_2026_27: RatePctSet = { basic: d('10.75'), higher: d('35.75'), additional: d('39.35') };

// Shared by every year we hold: the allowance, band widths and the small
// allowances have not moved since 2021-22 and are frozen to April 2031.
const STANDARD = {
  personalAllowance: d(12570),
  personalAllowanceTaperThreshold: d(100000),
  basicRateLimit: d(37700),
  additionalRateThreshold: d(125140),
  startingRateForSavingsLimit: d(5000),
  personalSavingsAllowance: { basic: d(1000), higher: d(500), additional: d(0) },
  dividendAllowance: d(500),
  propertyAllowance: d(1000),
  rentARoomLimit: d(7500),
} as const;

/** Pages that back the figures shared by every year in the table. */
const COMMON_SOURCES = [
  'https://www.gov.uk/income-tax-rates',
  'https://www.gov.uk/income-tax-rates/previous-tax-years',
  'https://www.gov.uk/government/publications/rates-and-allowances-income-tax/income-tax-rates-and-allowances-current-and-past',
  'https://www.gov.uk/apply-tax-free-interest-on-savings/how-much-is-tax-free',
  'https://www.gov.uk/guidance/tax-free-allowances-on-property-and-trading-income',
  'https://www.gov.uk/rent-room-in-your-home/the-rent-a-room-scheme',
  'https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies',
];

const RATE_TABLES: TaxRateTable[] = [
  // 2024-25: 20/40/45 on everything except dividends (8.75/33.75/39.35).
  // Dividend allowance cut from £1,000 to £500 from April 2024.
  {
    taxYear: '2024-25',
    startYear: 2024,
    provisional: false,
    provisionalNotes: [],
    sources: [
      ...COMMON_SOURCES,
      'https://www.gov.uk/tax-on-dividends',
      'https://www.gov.uk/government/publications/reduction-of-the-dividend-allowance',
      'https://www.gov.uk/government/publications/autumn-budget-2024-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances',
    ],
    ...STANDARD,
    nonSavingsRates: BANDS_20_40_45,
    propertyRates: BANDS_20_40_45,
    savingsRates: BANDS_20_40_45,
    dividendRates: DIVIDEND_2024_25,
    financeCostReliefRatePct: d(20),
  },

  // 2025-26: unchanged from 2024-25.
  {
    taxYear: '2025-26',
    startYear: 2025,
    provisional: false,
    provisionalNotes: [],
    sources: [
      ...COMMON_SOURCES,
      'https://www.gov.uk/tax-on-dividends',
      'https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/annex-a-rates-and-allowances',
      'https://www.gov.uk/government/publications/rent-a-room-for-traders-hs223-self-assessment-helpsheet/hs223-rent-a-room-scheme-2026',
    ],
    ...STANDARD,
    nonSavingsRates: BANDS_20_40_45,
    propertyRates: BANDS_20_40_45,
    savingsRates: BANDS_20_40_45,
    dividendRates: DIVIDEND_2024_25,
    financeCostReliefRatePct: d(20),
  },

  // 2026-27: dividend ordinary and upper rates rise 2 points to 10.75% and
  // 35.75% (additional stays 39.35%); legislated in Finance Act 2026 (c. 11).
  // Personal allowance and basic-rate limit are frozen to April 2031.
  {
    taxYear: '2026-27',
    startYear: 2026,
    provisional: false,
    provisionalNotes: [],
    sources: [
      ...COMMON_SOURCES,
      'https://www.gov.uk/tax-on-dividends',
      'https://www.gov.uk/government/publications/changes-to-tax-rates-for-property-savings-and-dividend-income/change-to-tax-rates-for-property-savings-and-dividend-income-technical-note',
      'https://www.gov.uk/government/publications/the-personal-allowance-and-basic-rate-limit-for-income-tax-and-certain-national-insurance-contributions-nics-thresholds-from-6-april-2026-to-5-apr/income-tax-personal-allowance-and-the-basic-rate-limit-and-certain-national-insurance-contributions-thresholds-from-6-april-2026-to-5-april-2028',
    ],
    ...STANDARD,
    nonSavingsRates: BANDS_20_40_45,
    propertyRates: BANDS_20_40_45,
    savingsRates: BANDS_20_40_45,
    dividendRates: DIVIDEND_2026_27,
    financeCostReliefRatePct: d(20),
  },

  // 2027-28: separate property income rates of 22/42/47% (Autumn Budget
  // 2025), savings rates rise to 22/42/47%, and the S.24 finance-cost
  // reducer is given at the 22% property basic rate. GOV.UK material and
  // search extracts of Finance Act 2026 (ss. 5-7) put the property and
  // savings rates in statute, but we could not open the Act itself, and the
  // main 20/40/45 rates and the small allowances for 2027-28 are carried
  // forward on the announced freeze rather than read from a 2027 Finance
  // Act, so the whole year stays provisional.
  {
    taxYear: '2027-28',
    startYear: 2027,
    provisional: true,
    provisionalNotes: [
      'Property income rates of 22/42/47% and finance-cost relief at 22% are from the Autumn Budget 2025 (Finance Act 2026 ss. 5-7 per GOV.UK extracts; not independently opened).',
      'Main 20/40/45% rates, allowances and the unchanged personal allowance / basic-rate limit are carried forward from the announced freeze to April 2031.',
    ],
    sources: [
      ...COMMON_SOURCES,
      'https://www.gov.uk/government/publications/changes-to-tax-rates-for-property-savings-and-dividend-income/change-to-tax-rates-for-property-savings-and-dividend-income-technical-note',
      'https://www.gov.uk/government/publications/budget-2025-overview-of-tax-legislation-and-rates-ootlar/budget-2025-overview-of-tax-legislation-and-rates-ootlar',
      'https://www.gov.uk/government/publications/maintaining-income-tax-and-equivalent-national-insurance-contributions-thresholds-until-5-april-2031',
      'https://www.legislation.gov.uk/ukpga/2026/11/section/7',
    ],
    ...STANDARD,
    nonSavingsRates: BANDS_20_40_45,
    propertyRates: BANDS_22_42_47,
    savingsRates: BANDS_22_42_47,
    dividendRates: DIVIDEND_2026_27,
    financeCostReliefRatePct: d(22),
  },
];

const RATES_BY_YEAR: ReadonlyMap<string, TaxRateTable> = new Map(
  RATE_TABLES.map(t => [t.taxYear, t]),
);

export const EARLIEST_KNOWN_TAX_YEAR = RATE_TABLES[0].taxYear;
export const LATEST_KNOWN_TAX_YEAR = RATE_TABLES[RATE_TABLES.length - 1].taxYear;

export interface ResolvedRates {
  table: TaxRateTable;
  /**
   * True when the requested year has no table of its own and the nearest
   * known year was used instead. Callers must surface this to the user.
   */
  ratesAssumed: boolean;
}

/**
 * Rates for a tax year label ('2025-26'). Years after the last table use
 * the latest table; years before the first use the earliest (the nearest
 * known year in both cases). Either way `ratesAssumed` is true.
 * Throws ClientError for a malformed label.
 */
export function getRatesForTaxYear(label: string): ResolvedRates {
  const startYear = parseTaxYearLabel(label);
  const key = taxYearRange(startYear).label;
  const exact = RATES_BY_YEAR.get(key);
  if (exact) return { table: exact, ratesAssumed: false };
  const first = RATE_TABLES[0];
  const last = RATE_TABLES[RATE_TABLES.length - 1];
  return { table: startYear < first.startYear ? first : last, ratesAssumed: true };
}

/**
 * Making Tax Digital for Income Tax Self Assessment mandation. A person is
 * required to use MTD ITSA from `mandatoryFrom` if their qualifying income
 * (gross self-employment plus property receipts, before expenses) in
 * `basedOnTaxYear` was MORE than `threshold`.
 *
 * Sources:
 *   https://www.gov.uk/guidance/check-if-youre-eligible-for-making-tax-digital-for-income-tax
 *   https://www.gov.uk/government/publications/making-tax-digital-for-income-tax-self-assessment-reducing-the-mandation-threshold-from-30000-to-20000-from-april-2028/reduction-of-the-mandation-threshold-from-30000-to-20000-from-april-2028
 */
export interface MtdItsaCohort {
  basedOnTaxYear: string;
  threshold: Decimal;
  mandatoryFrom: string;
}

export const MTD_ITSA_COHORTS: readonly MtdItsaCohort[] = [
  { basedOnTaxYear: '2024-25', threshold: d(50000), mandatoryFrom: '2026-04-06' },
  { basedOnTaxYear: '2025-26', threshold: d(30000), mandatoryFrom: '2027-04-06' },
  { basedOnTaxYear: '2026-27', threshold: d(20000), mandatoryFrom: '2028-04-06' },
];

/** Payments on account (HMRC: gov.uk/understand-self-assessment-bill/payments-on-account). */
export const PAYMENTS_ON_ACCOUNT = {
  /** No payments on account when the balance is below this. */
  minimumBalance: d(1000),
  /** No payments on account when MORE than this share was collected at source. */
  maxCollectedAtSourcePct: d(80),
} as const;
