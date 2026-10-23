/**
 * Full UK (rUK) income-tax liability for one person and one tax year.
 *
 * Income is stacked in HMRC's order, each layer filling the bands the one
 * before left:
 *
 *   1. non-savings   employment, self-employment profit, other income
 *   2. property      UK property profit (after losses brought forward)
 *   3. savings       bank/building-society interest
 *   4. dividends
 *
 * Until 2027-28 property is just part of non-savings income and taxed at the
 * same rates; from 2027-28 it has its own (higher) rates. Keeping it as its
 * own layer in every year gives the right answer in both regimes, because
 * the personal allowance is used up by non-property income first and the
 * stack order is the same either way.
 *
 * Gross relief-at-source pension contributions reduce adjusted net income
 * and extend both tax-band limits. Net-pay and salary-sacrifice deductions
 * must already have been removed from the supplied employment income.
 * Not modelled: Gift Aid, the marriage allowance, blind person's allowance, the
 * High Income Child Benefit Charge, National Insurance, and anything
 * Scottish. Tax is rounded to the penny per band; HMRC's own software
 * truncates some intermediate figures to whole pounds, so a Self Assessment
 * return can differ from this by a few pounds.
 */

import Decimal from 'decimal.js';
import { formatCurrency } from '@/lib/utils/formatting';
import type { BreakdownLine } from './breakdown';
import { nonNegativeMoney, round2 } from './moneyInput';
import type { RatePctSet, TaxRateTable } from './taxRates';

export type BandName = 'basic' | 'higher' | 'additional';
export type IncomeLayer = 'non_savings' | 'property' | 'savings' | 'dividends';
/** `band` for taxed income, otherwise which 0% allowance covered it. */
export type TaxRowKind = BandName | 'starting_rate' | 'personal_savings_allowance' | 'dividend_allowance';

const SECTION = 'Income tax';

export const LAYER_LABEL: Record<IncomeLayer, string> = {
  non_savings: 'Employment & other income',
  property: 'Property profit',
  savings: 'Savings interest',
  dividends: 'Dividends',
};

export const KIND_LABEL: Record<TaxRowKind, string> = {
  basic: 'basic rate',
  higher: 'higher rate',
  additional: 'additional rate',
  starting_rate: 'starting rate for savings',
  personal_savings_allowance: 'personal savings allowance',
  dividend_allowance: 'dividend allowance',
};

export interface IncomeTaxInputs {
  rates: TaxRateTable;
  /** Employment, self-employment profit and other non-property, non-savings income. */
  nonSavingsIncome: Decimal.Value;
  /** UK property profit after losses brought forward. Never negative. */
  propertyProfit: Decimal.Value;
  savingsInterest: Decimal.Value;
  dividends: Decimal.Value;
  /** Finance costs for this year that S.24 restricts to basic-rate relief. */
  financeCostsThisYear: Decimal.Value;
  financeCostsBroughtForward: Decimal.Value;
  /** Gross, relievable personal pension contributions paid using relief at source. */
  reliefAtSourcePensionGross?: Decimal.Value;
}

export interface TaxRow {
  layer: IncomeLayer;
  kind: TaxRowKind;
  income: Decimal;
  ratePct: Decimal;
  tax: Decimal;
}

export type FinanceCostLimit = 'finance_costs' | 'property_profits' | 'adjusted_total_income' | 'none';

export interface FinanceCostReducerResult {
  reliefRatePct: Decimal;
  /** This year's finance costs plus any brought forward. */
  financeCostsAvailable: Decimal;
  /** Cap 2: property profit after losses. */
  propertyProfitCap: Decimal;
  /** Cap 3: non-savings, non-dividend income above the personal allowance. */
  adjustedTotalIncomeCap: Decimal;
  /** Lowest of the three; the amount that actually earns relief. */
  relievableAmount: Decimal;
  limitedBy: FinanceCostLimit;
  /** relievableAmount x relief rate (never more than the tax due). */
  reducer: Decimal;
  /** Unrelieved finance costs carried forward to next year. */
  carriedForward: Decimal;
}

export interface PersonalAllowanceResult {
  standard: Decimal;
  taperReduction: Decimal;
  effective: Decimal;
  /** How much of the effective allowance was set against income. */
  used: Decimal;
}

export interface IncomeTaxResult {
  totalIncome: Decimal;
  adjustedNetIncome: Decimal;
  reliefAtSourcePensionGross: Decimal;
  layerIncome: Record<IncomeLayer, Decimal>;
  layerTaxable: Record<IncomeLayer, Decimal>;
  personalAllowance: PersonalAllowanceResult;
  rows: TaxRow[];
  taxBeforeReductions: Decimal;
  financeCostReducer: FinanceCostReducerResult;
  liability: Decimal;
  lines: BreakdownLine[];
}

/** Tax-free amount the personal allowance gives after the £100k taper. */
function personalAllowanceFor(adjustedNetIncome: Decimal, rates: TaxRateTable) {
  const excess = Decimal.max(adjustedNetIncome.minus(rates.personalAllowanceTaperThreshold), 0);
  const taperReduction = Decimal.min(excess.div(2), rates.personalAllowance);
  return {
    standard: rates.personalAllowance,
    taperReduction,
    effective: rates.personalAllowance.minus(taperReduction),
  };
}

/**
 * Split `amount` of taxable income, starting after `cursor` pounds of
 * taxable income already stacked, across the three bands.
 */
function splitAcrossBands(
  amount: Decimal,
  cursor: Decimal,
  rates: TaxRateTable,
): Array<{ band: BandName; income: Decimal }> {
  const basicRoom = Decimal.max(rates.basicRateLimit.minus(cursor), 0);
  const inBasic = Decimal.min(amount, basicRoom);
  const afterBasic = amount.minus(inBasic);

  const higherFloor = Decimal.max(cursor, rates.basicRateLimit);
  const higherRoom = Decimal.max(rates.additionalRateThreshold.minus(higherFloor), 0);
  const inHigher = Decimal.min(afterBasic, higherRoom);
  const inAdditional = afterBasic.minus(inHigher);

  const parts: Array<{ band: BandName; income: Decimal }> = [];
  if (inBasic.gt(0)) parts.push({ band: 'basic', income: inBasic });
  if (inHigher.gt(0)) parts.push({ band: 'higher', income: inHigher });
  if (inAdditional.gt(0)) parts.push({ band: 'additional', income: inAdditional });
  return parts;
}

function rateFor(set: RatePctSet, band: BandName): Decimal {
  return set[band];
}

function pct(value: Decimal): string {
  return `${value.toDecimalPlaces(2).toString()}%`;
}

export function computeIncomeTax(inputs: IncomeTaxInputs): IncomeTaxResult {
  const { rates } = inputs;
  const reliefAtSourcePensionGross = nonNegativeMoney(inputs.reliefAtSourcePensionGross, 'Gross relief-at-source pension contributions');
  // ITA 2007 s10/s13 and s58: relief at source extends band limits and
  // reduces ANI; it is not deducted from taxable employment income again.
  const effectiveRates: TaxRateTable = {
    ...rates,
    basicRateLimit: rates.basicRateLimit.plus(reliefAtSourcePensionGross),
    additionalRateThreshold: rates.additionalRateThreshold.plus(reliefAtSourcePensionGross),
  };

  const layerIncome: Record<IncomeLayer, Decimal> = {
    non_savings: nonNegativeMoney(inputs.nonSavingsIncome, 'Non-savings income'),
    property: nonNegativeMoney(inputs.propertyProfit, 'Property profit'),
    savings: nonNegativeMoney(inputs.savingsInterest, 'Savings interest'),
    dividends: nonNegativeMoney(inputs.dividends, 'Dividends'),
  };
  const financeThisYear = nonNegativeMoney(inputs.financeCostsThisYear, 'Finance costs');
  const financeBroughtForward = nonNegativeMoney(
    inputs.financeCostsBroughtForward,
    'Finance costs brought forward',
  );

  const totalIncome = layerIncome.non_savings
    .plus(layerIncome.property)
    .plus(layerIncome.savings)
    .plus(layerIncome.dividends);
  const adjustedNetIncome = Decimal.max(totalIncome.minus(reliefAtSourcePensionGross), 0);

  const lines: BreakdownLine[] = [];
  const addLine = (text: string, amount: Decimal | null = null) =>
    lines.push({ section: SECTION, text, amount: amount ? amount.toFixed(2) : null });

  addLine(
    `Total income ${formatCurrency(totalIncome)}: employment & other ${formatCurrency(layerIncome.non_savings)}, ` +
      `property profit ${formatCurrency(layerIncome.property)}, savings ${formatCurrency(layerIncome.savings)}, ` +
      `dividends ${formatCurrency(layerIncome.dividends)}.`,
    totalIncome,
  );

  // Personal allowance, tapered by £1 for every £2 of income over £100,000.
  if (reliefAtSourcePensionGross.gt(0)) {
    addLine(
      `Gross relief-at-source pension contributions ${formatCurrency(reliefAtSourcePensionGross)} reduce adjusted net income to ${formatCurrency(adjustedNetIncome)} and extend the basic and higher-rate band limits by the same amount.`,
      adjustedNetIncome,
    );
  }
  const pa = personalAllowanceFor(adjustedNetIncome, rates);
  if (pa.taperReduction.gt(0)) {
    addLine(
      `Personal allowance ${formatCurrency(pa.standard)} reduced by ${formatCurrency(pa.taperReduction)} ` +
        `(${reliefAtSourcePensionGross.gt(0) ? 'adjusted net income' : 'income'} is ${formatCurrency(adjustedNetIncome.minus(rates.personalAllowanceTaperThreshold))} over ` +
        `${formatCurrency(rates.personalAllowanceTaperThreshold)}, losing £1 for every £2) to ${formatCurrency(pa.effective)}.`,
      pa.effective,
    );
  } else {
    addLine(`Personal allowance ${formatCurrency(pa.effective)} (no taper, income is not over ${formatCurrency(rates.personalAllowanceTaperThreshold)}).`, pa.effective);
  }

  // The allowance is set against income in stack order, so non-property
  // income soaks it up before property, then savings, then dividends.
  let allowanceLeft = pa.effective;
  const layerTaxable = {} as Record<IncomeLayer, Decimal>;
  for (const layer of ['non_savings', 'property', 'savings', 'dividends'] as const) {
    const applied = Decimal.min(layerIncome[layer], allowanceLeft);
    allowanceLeft = allowanceLeft.minus(applied);
    layerTaxable[layer] = layerIncome[layer].minus(applied);
  }
  const allowanceUsed = pa.effective.minus(allowanceLeft);
  const totalTaxable = Object.values(layerTaxable).reduce((acc, v) => acc.plus(v), new Decimal(0));
  addLine(
    `Personal allowance used ${formatCurrency(allowanceUsed)}; taxable income after allowance ${formatCurrency(totalTaxable)}.`,
    totalTaxable,
  );

  // Stack the layers through the bands. `cursor` is how much taxable income
  // has been stacked so far; 0% slices (allowances) still advance it
  // because they use up band space.
  const rows: TaxRow[] = [];
  let cursor = new Decimal(0);

  const pushNilRate = (layer: IncomeLayer, kind: TaxRowKind, income: Decimal) => {
    if (income.lte(0)) return;
    rows.push({ layer, kind, income, ratePct: new Decimal(0), tax: new Decimal(0) });
    cursor = cursor.plus(income);
  };
  const pushTaxed = (layer: IncomeLayer, income: Decimal, ratePcts: RatePctSet) => {
    if (income.lte(0)) return;
    for (const part of splitAcrossBands(income, cursor, effectiveRates)) {
      const ratePct = rateFor(ratePcts, part.band);
      rows.push({
        layer,
        kind: part.band,
        income: part.income,
        ratePct,
        tax: round2(part.income.mul(ratePct).div(100)),
      });
    }
    cursor = cursor.plus(income);
  };

  pushTaxed('non_savings', layerTaxable.non_savings, rates.nonSavingsRates);
  pushTaxed('property', layerTaxable.property, rates.propertyRates);

  // Savings: the starting-rate band (0%, shrinks pound-for-pound with
  // non-savings taxable income), then the personal savings allowance (0%,
  // sized by the taxpayer's highest band), then the rest at savings rates.
  const nonSavingsTaxable = layerTaxable.non_savings.plus(layerTaxable.property);
  const startingRoom = Decimal.max(rates.startingRateForSavingsLimit.minus(nonSavingsTaxable), 0);
  const startingUsed = Decimal.min(layerTaxable.savings, startingRoom);
  pushNilRate('savings', 'starting_rate', startingUsed);

  const psaAmount = totalTaxable.lte(effectiveRates.basicRateLimit)
    ? rates.personalSavingsAllowance.basic
    : totalTaxable.lte(effectiveRates.additionalRateThreshold)
      ? rates.personalSavingsAllowance.higher
      : rates.personalSavingsAllowance.additional;
  const psaUsed = Decimal.min(layerTaxable.savings.minus(startingUsed), psaAmount);
  pushNilRate('savings', 'personal_savings_allowance', psaUsed);
  pushTaxed('savings', layerTaxable.savings.minus(startingUsed).minus(psaUsed), rates.savingsRates);

  // Dividends: allowance first (0%, still uses band space), then the rest.
  const dividendAllowanceUsed = Decimal.min(layerTaxable.dividends, rates.dividendAllowance);
  pushNilRate('dividends', 'dividend_allowance', dividendAllowanceUsed);
  pushTaxed('dividends', layerTaxable.dividends.minus(dividendAllowanceUsed), rates.dividendRates);

  for (const row of rows) {
    const where = row.ratePct.isZero() ? `covered by ${KIND_LABEL[row.kind]}, 0%` : `${KIND_LABEL[row.kind]} at ${pct(row.ratePct)}`;
    addLine(`${LAYER_LABEL[row.layer]}: ${formatCurrency(row.income)} ${where} = ${formatCurrency(row.tax)}.`, row.tax);
  }

  const taxBeforeReductions = rows.reduce((acc, r) => acc.plus(r.tax), new Decimal(0));
  addLine(`Income tax before reductions ${formatCurrency(taxBeforeReductions)}.`, taxBeforeReductions);

  // S.24 finance-cost tax reducer: relief rate x the LOWEST of
  //   (1) finance costs (this year + brought forward)
  //   (2) property profit after losses
  //   (3) adjusted total income above the personal allowance, i.e.
  //       non-savings, non-dividend income less the allowance
  // Whatever (1) exceeds the lowest figure carries forward.
  const financeAvailable = financeThisYear.plus(financeBroughtForward);
  const propertyProfitCap = layerIncome.property;
  const adjustedTotalIncomeCap = Decimal.max(
    layerIncome.non_savings.plus(layerIncome.property).minus(pa.effective),
    0,
  );
  let relievable = Decimal.max(Decimal.min(financeAvailable, propertyProfitCap, adjustedTotalIncomeCap), 0);
  let limitedBy: FinanceCostLimit = 'none';
  if (financeAvailable.gt(0)) {
    if (relievable.eq(financeAvailable)) limitedBy = 'finance_costs';
    else if (relievable.eq(propertyProfitCap)) limitedBy = 'property_profits';
    else limitedBy = 'adjusted_total_income';
  }
  let reducer = round2(relievable.mul(rates.financeCostReliefRatePct).div(100));
  if (reducer.gt(taxBeforeReductions)) {
    // A reducer can only cancel tax, never create a refund.
    reducer = taxBeforeReductions;
    relievable = rates.financeCostReliefRatePct.isZero()
      ? relievable
      : reducer.mul(100).div(rates.financeCostReliefRatePct);
  }
  const carriedForward = financeAvailable.minus(relievable);

  const financeCostReducer: FinanceCostReducerResult = {
    reliefRatePct: rates.financeCostReliefRatePct,
    financeCostsAvailable: financeAvailable,
    propertyProfitCap,
    adjustedTotalIncomeCap,
    relievableAmount: relievable,
    limitedBy,
    reducer,
    carriedForward,
  };

  if (financeAvailable.gt(0)) {
    const limitText: Record<FinanceCostLimit, string> = {
      finance_costs: 'finance costs are the lowest figure, so all of them are relieved',
      property_profits: 'property profit is the lowest figure, so relief is capped there',
      adjusted_total_income: 'adjusted total income above the personal allowance is the lowest figure, so relief is capped there',
      none: '',
    };
    addLine(
      `S.24 finance-cost reducer: finance costs ${formatCurrency(financeAvailable)} ` +
        `(${formatCurrency(financeThisYear)} this year + ${formatCurrency(financeBroughtForward)} brought forward), ` +
        `property profit ${formatCurrency(propertyProfitCap)}, adjusted total income above allowance ${formatCurrency(adjustedTotalIncomeCap)}; ` +
        `${limitText[limitedBy]}. ${formatCurrency(relievable)} x ${pct(rates.financeCostReliefRatePct)} = ${formatCurrency(reducer)} off the tax bill.`,
      reducer,
    );
    if (carriedForward.gt(0)) {
      addLine(`Finance costs carried forward to next year: ${formatCurrency(carriedForward)}.`, carriedForward);
    }
  }

  const liability = taxBeforeReductions.minus(reducer);
  addLine(`Income tax liability for the year ${formatCurrency(liability)}.`, liability);

  return {
    totalIncome,
    adjustedNetIncome,
    reliefAtSourcePensionGross,
    layerIncome,
    layerTaxable,
    personalAllowance: { ...pa, used: allowanceUsed },
    rows,
    taxBeforeReductions,
    financeCostReducer,
    liability,
    lines,
  };
}
