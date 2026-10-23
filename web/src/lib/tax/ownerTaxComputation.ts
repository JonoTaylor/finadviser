/**
 * One owner's UK income-tax position for one tax year, with the rental
 * income worked through in full. Pure: the repo gathers the per-property
 * owner-share totals and the saved tax profile, this turns them into a
 * result. The output is plain JSON (money as decimal strings, no Decimal
 * instances) so the API, UI, CSV export and AI tool can all use it as is.
 *
 * Flow:
 *   1. Pick the rates for the year (fallback flagged via `rates.assumed`).
 *   2. Pool the owner's rent-a-room lettings into ONE computation with a
 *      single limit (PIM4010) and list the rent-a-room treatments that are
 *      valid: exempt (receipts within the limit), alternative (over it) or
 *      normal (always: elected out of, or not using, the scheme).
 *   3. For each valid treatment work the UK property profit under actual
 *      expenses and, when the property allowance is available, under the
 *      allowance too, running each through the FULL income-tax calculation.
 *      The choice is made on the final tax, not on profit, because the
 *      S.24 reducer and its carry-forward are only kept by some options
 *      (PIM4030, PIM4460).
 *   4. Choose the cheapest combination (see `chooseTreatment` for ties).
 *   5. Re-run without any property to isolate the tax on rental income.
 *   6. Self Assessment balance, payments on account, MTD ITSA status.
 */

import Decimal from 'decimal.js';
import { ClientError } from '@/lib/errors';
import { formatCurrency } from '@/lib/utils/formatting';
import type { BreakdownLine } from './breakdown';
import {
  KIND_LABEL,
  LAYER_LABEL,
  computeIncomeTax,
  type FinanceCostLimit,
  type IncomeLayer,
  type IncomeTaxResult,
  type TaxRowKind,
} from './incomeTax';
import { computeMtdItsaStatus, type MtdItsaStatus } from './mtdItsa';
import { nonNegativeMoney, round2, signedMoney } from './moneyInput';
import {
  computePropertyIncome,
  poolRentARoom,
  type LettingType,
  type PropertyIncomeResult,
  type PropertyLetting,
  type PropertyMethod,
  type RentARoomPool,
  type RentARoomTreatment,
} from './propertyTax';
import { PAYMENTS_ON_ACCOUNT, getRatesForTaxYear } from './taxRates';
import { parseTaxYearLabel, taxYearRange } from './ukTaxYear';

export type { LettingType, PropertyLetting, PropertyMethod, RentARoomTreatment };

export const TAX_COMPUTATION_DISCLAIMER =
  'Estimate only, not tax advice. Check the figures with your accountant before filing or paying.';

export interface OwnerTaxProfileInput {
  employmentIncome: Decimal.Value;
  /** Tax already deducted at source (PAYE) for the year. */
  payeTaxPaid: Decimal.Value;
  /** Self-employment profit (also used as turnover for the MTD test). */
  selfEmploymentIncome: Decimal.Value;
  savingsInterest: Decimal.Value;
  dividends: Decimal.Value;
  otherIncome: Decimal.Value;
  propertyLossesBroughtForward: Decimal.Value;
  financeCostsBroughtForward: Decimal.Value;
  /** Gross annual employee contribution; employer contributions never go here. */
  pensionAnnualAmount?: Decimal.Value | null;
  pensionMethod?: 'salary_sacrifice' | 'net_pay' | 'relief_at_source' | 'unknown';
  /** Prevents deducting pension twice when P60 taxable pay is entered. */
  employmentIncomeBasis?: 'gross_before_pension' | 'taxable_pay_after_pension' | 'unknown';
}

export interface OwnerTaxInputs {
  taxYear: string;
  /** One entry per property, at the owner's share. */
  properties: PropertyLetting[];
  profile: OwnerTaxProfileInput;
}

/**
 * One option the engine ran through the full income-tax calculation: a
 * standard-pool method combined with a rent-a-room treatment. Without
 * rent-a-room lettings there are just the two methods.
 */
export interface MethodComparison {
  method: PropertyMethod;
  /** The rent-a-room treatment this option assumes; null when the owner has no rent-a-room lettings. */
  rentARoom: RentARoomTreatment | null;
  label: string;
  available: boolean;
  /** True for the option the computation uses. */
  chosen: boolean;
  /** Property profit taxed under this method (after losses); null when not available. */
  propertyProfit: string | null;
  /** S.24 tax reducer under this method; null when not available. */
  financeCostReducer: string | null;
  /** Total income-tax liability under this method; null when not available. */
  liability: string | null;
  note: string;
}

/** The pooled rent-a-room computation and the treatment chosen for it. */
export interface RentARoomSummary {
  treatment: RentARoomTreatment;
  /** Why this treatment: what it gave against the alternatives. */
  reason: string;
  /** The single limit applied to the pooled receipts. */
  limit: string;
  /** True when any pooled letting is shared, which halves the limit. */
  shared: boolean;
  receipts: string;
  /** Total expenses, excluding finance costs. */
  expenses: string;
  financeCosts: string;
  /** receipts - limit (floored at 0): what the alternative method would tax. */
  alternativeTaxable: string;
  /** receipts - expenses: what the normal method would add (negative = a loss). */
  normalResult: string;
  /** What the rent-a-room lettings add to the property business under the chosen treatment (negative = a loss). */
  taxable: string;
}

export interface PaymentOnAccount {
  dueDate: string;
  amount: string;
}

export interface OwnerTaxComputation {
  taxYear: string;
  rates: {
    taxYear: string;
    assumed: boolean;
    provisional: boolean;
    provisionalNotes: string[];
    sources: string[];
  };
  income: {
    nonSavings: string;
    propertyProfit: string;
    savings: string;
    dividends: string;
    total: string;
    adjustedNetIncome?: string;
  };
  pension?: {
    method: NonNullable<OwnerTaxProfileInput['pensionMethod']>;
    employmentIncomeBasis: NonNullable<OwnerTaxProfileInput['employmentIncomeBasis']>;
    annualEmployeeAmount: string | null;
    employmentDeduction: string;
    reliefAtSourceGross: string;
    applied: boolean;
  };
  property: {
    method: PropertyMethod;
    /** Why this expenses-or-allowance method, given the rent-a-room treatment. */
    methodReason: string;
    /** Every option run through the income-tax calculation (method x rent-a-room treatment), the chosen one flagged. */
    methods: MethodComparison[];
    // The "standard" figures describe the ordinary property-business pool:
    // under the normal rent-a-room treatment they include those lettings.
    standardGrossIncome: string;
    standardExpenses: string;
    profitByExpenses: string;
    profitByAllowance: string;
    allowanceRelief: 'full' | 'partial' | 'none';
    /** Each rent-a-room letting's own figures, as pooled. Empty when there are none. */
    rentARoom: Array<{
      name: string;
      receipts: string;
      expenses: string;
      financeCosts: string;
      shared: boolean;
    }>;
    /** The pooled rent-a-room computation; null when the owner has no rent-a-room lettings. */
    rentARoomPool: RentARoomSummary | null;
    currentYearResult: string;
    lossesBroughtForward: string;
    lossesUsed: string;
    taxableProfit: string;
    lossesCarriedForward: string;
    /** True when any loss was brought forward or is carried forward (UI shows the loss line). */
    hasLosses: boolean;
  };
  financeCosts: {
    claimedThisYear: string;
    broughtForward: string;
    available: string;
    relieved: string;
    limitedBy: FinanceCostLimit;
    reliefRatePct: string;
    reducer: string;
    carriedForward: string;
    /** True when there are finance costs to show (this year or brought forward). */
    hasFinanceCosts: boolean;
    hasCarriedForward: boolean;
  };
  incomeTax: {
    personalAllowance: { standard: string; taperReduction: string; effective: string; tapered: boolean };
    rows: Array<{
      layer: IncomeLayer;
      layerLabel: string;
      kind: TaxRowKind;
      kindLabel: string;
      income: string;
      ratePct: string;
      tax: string;
    }>;
    taxBeforeReductions: string;
    financeCostReducer: string;
    liability: string;
  };
  /** The tax attributable to rental income: liability with property minus liability without. */
  taxOnRentalIncome: {
    amount: string;
    liabilityWithProperty: string;
    liabilityWithoutProperty: string;
  };
  selfAssessment: {
    payeTaxPaid: string;
    /** Liability minus PAYE already paid. Negative means an overpayment. */
    balanceDue: string;
    /** The part of the balance still to pay: balanceDue, or 0.00 when overpaid. */
    amountDue: string;
    /** The overpayment to be repaid: 0.00 unless PAYE paid exceeds the liability. */
    refundDue: string;
    isRefund: boolean;
    /** Online filing and payment deadline for the balance. */
    deadline: string;
    paymentsOnAccount: {
      required: boolean;
      reason: string;
      /** Percentage of the liability already collected at source. */
      collectedAtSourcePct: string;
      instalments: PaymentOnAccount[];
      /** What is due on the deadline: the balance plus the first payment on account. */
      dueOnDeadline: string;
    };
  };
  mtd: MtdItsaStatus;
  warnings: string[];
  disclaimer: string;
  breakdown: BreakdownLine[];
}

interface Scenario {
  property: PropertyIncomeResult;
  tax: IncomeTaxResult;
}

/** Everything worked out for one rent-a-room treatment (null = the owner has no rent-a-room lettings). */
interface TreatmentEvaluation {
  treatment: RentARoomTreatment | null;
  byExpenses: Scenario;
  /** Null when the allowance is not available; the reason is in `allowanceBlockedReason`. */
  byAllowance: Scenario | null;
  allowanceBlockedReason: string | null;
  /** The cheaper standard-pool method for this treatment (a tie goes to actual expenses). */
  best: Scenario;
  bestMethod: PropertyMethod;
}

function fixed2(value: Decimal): string {
  return value.toFixed(2);
}

/** Losses and finance costs this option leaves to carry forward, in pounds. */
function carryForwardOf(s: Scenario): Decimal {
  return s.property.lossesCarriedForward.plus(s.tax.financeCostReducer.carriedForward);
}

/** Tie-break order between rent-a-room treatments: lower wins. */
const TREATMENT_PREFERENCE: Record<RentARoomTreatment, number> = { exempt: 0, normal: 1, alternative: 2 };

/**
 * Pick the rent-a-room treatment (with its best standard method) to use.
 *
 * Lowest income-tax liability wins. On an exact tie the tie-breaks are, in
 * order:
 *   1. the option that keeps more property-loss and finance-cost
 *      carry-forward (a loss or unrelieved finance cost kept is relief
 *      banked for later years);
 *   2. 'exempt' over 'normal' over 'alternative' (the least elective route).
 * Within one treatment the expenses-or-allowance choice keeps its existing
 * rule, applied before this: the allowance only if it is strictly cheaper, so
 * a tie there goes to actual expenses. Without rent-a-room lettings there is
 * a single evaluation and nothing here changes the outcome.
 */
function chooseTreatment(evaluations: TreatmentEvaluation[]): TreatmentEvaluation {
  const ranked = [...evaluations].sort(
    (a, b) =>
      a.best.tax.liability.comparedTo(b.best.tax.liability) ||
      carryForwardOf(b.best).comparedTo(carryForwardOf(a.best)) ||
      TREATMENT_PREFERENCE[a.treatment ?? 'exempt'] - TREATMENT_PREFERENCE[b.treatment ?? 'exempt'],
  );
  return ranked[0];
}

const TREATMENT_SHORT_LABEL: Record<RentARoomTreatment, string> = {
  exempt: 'rent-a-room exempt',
  alternative: 'rent-a-room alternative method',
  normal: 'rent-a-room normal method',
};

const TREATMENT_NOTE: Record<RentARoomTreatment, string> = {
  exempt: 'Rent-a-room receipts are exempt; their expenses and finance costs are not claimed.',
  alternative: 'Rent-a-room receipts over the limit are taxed with no expenses and no finance-cost relief.',
  normal: 'Rent-a-room lettings join the property business as ordinary income: losses pool, and finance costs join the S.24 pool unless the allowance is used.',
};

export function computeOwnerTax(inputs: OwnerTaxInputs): OwnerTaxComputation {
  const taxYear = taxYearRange(parseTaxYearLabel(inputs.taxYear)).label;
  const { table: rates, ratesAssumed } = getRatesForTaxYear(taxYear);
  const profile = inputs.profile;

  const employment = nonNegativeMoney(profile.employmentIncome, 'Employment income');
  const selfEmployment = nonNegativeMoney(profile.selfEmploymentIncome, 'Self-employment income');
  const otherIncome = nonNegativeMoney(profile.otherIncome, 'Other income');
  const savings = nonNegativeMoney(profile.savingsInterest, 'Savings interest');
  const dividends = nonNegativeMoney(profile.dividends, 'Dividends');
  const payeTaxPaid = nonNegativeMoney(profile.payeTaxPaid, 'PAYE tax paid');
  const lossesBroughtForward = nonNegativeMoney(profile.propertyLossesBroughtForward, 'Property losses brought forward');
  const financeBroughtForward = nonNegativeMoney(profile.financeCostsBroughtForward, 'Finance costs brought forward');
  const pensionAmountKnown = profile.pensionAnnualAmount !== undefined && profile.pensionAnnualAmount !== null;
  const pensionAmount = nonNegativeMoney(profile.pensionAnnualAmount, 'Annual gross employee pension contribution');
  const pensionMethod = profile.pensionMethod ?? 'unknown';
  const employmentIncomeBasis = profile.employmentIncomeBasis ?? 'unknown';
  const pensionSpecified = pensionAmountKnown || profile.pensionMethod !== undefined;
  const pensionWarnings: string[] = [];
  let employmentDeduction = new Decimal(0);
  let reliefAtSourceGross = new Decimal(0);
  let pensionApplied = false;
  if (!pensionAmountKnown && pensionMethod !== 'unknown') {
    pensionWarnings.push('No annual employee pension amount is confirmed, so no additional pension relief has been assumed.');
  }
  if (pensionAmountKnown) {
    if (pensionMethod === 'relief_at_source') {
      reliefAtSourceGross = pensionAmount;
      pensionApplied = true;
    } else if (pensionMethod === 'salary_sacrifice' || pensionMethod === 'net_pay') {
      if (employmentIncomeBasis === 'gross_before_pension') {
        if (pensionAmount.gt(employment)) {
          throw new ClientError('The annual pension deduction cannot exceed gross employment income');
        }
        employmentDeduction = pensionAmount;
        pensionApplied = true;
      } else if (employmentIncomeBasis === 'taxable_pay_after_pension') {
        // P60 taxable pay has already received the deduction. Its tax/ANI
        // effect is in employment income, so no further reduction is made.
        pensionApplied = true;
      } else if (pensionAmount.gt(0)) {
        pensionWarnings.push('Pension relief has not been assumed: confirm whether employment income is gross before pension or taxable pay after pension deductions.');
      }
    } else if (pensionAmount.gt(0)) {
      pensionWarnings.push('Pension relief has not been assumed: confirm salary sacrifice, net pay or relief at source. An employee contribution percentage alone does not establish its tax treatment.');
    }
    if (pensionApplied && pensionAmount.gt(0)) {
      pensionWarnings.push('Pension treatment assumes the recorded gross employee contribution qualifies for relief. Earnings limits, annual allowance, carry-forward and any annual allowance charge are not assessed. Employer matching is not an employee income-tax deduction.');
    }
  }
  const nonSavings = employment.minus(employmentDeduction).plus(selfEmployment).plus(otherIncome);

  const runScenario = (method: PropertyMethod, treatment: RentARoomTreatment | null): Scenario => {
    const property = computePropertyIncome({
      rates,
      properties: inputs.properties,
      method,
      rentARoomTreatment: treatment ?? undefined,
      lossesBroughtForward,
    });
    const tax = computeIncomeTax({
      rates,
      nonSavingsIncome: nonSavings,
      propertyProfit: property.taxableProfit,
      savingsInterest: savings,
      dividends,
      financeCostsThisYear: property.financeCostsClaimed,
      financeCostsBroughtForward: financeBroughtForward,
      reliefAtSourcePensionGross: reliefAtSourceGross,
    });
    return { property, tax };
  };

  // ---- Choose between actual expenses and the property allowance ----
  // Done once per valid rent-a-room treatment (just once when the owner has
  // no rent-a-room lettings). Under the normal treatment the rent-a-room
  // receipts are ordinary property income, so the allowance is judged on the
  // merged pool.
  const evaluate = (treatment: RentARoomTreatment | null): TreatmentEvaluation => {
    const byExpenses = runScenario('expenses', treatment);
    const allowanceRelief = byExpenses.property.standard.allowanceRelief;

    let byAllowance: Scenario | null = null;
    let allowanceBlockedReason: string | null = null;
    if (allowanceRelief === 'none') {
      allowanceBlockedReason =
        treatment === 'normal'
          ? 'No lettings receipts for the allowance to cover.'
          : 'No standard lettings receipts for the allowance to cover.';
    } else if (
      allowanceRelief === 'partial' &&
      financeBroughtForward.gt(0) &&
      byExpenses.tax.financeCostReducer.reducer.gt(0)
    ) {
      // PIM4460: brought-forward finance costs are applied automatically
      // against taxable income, which rules out partial relief for the year.
      allowanceBlockedReason =
        'Finance costs brought forward are being relieved this year, which rules out the partial-relief property allowance.';
    } else {
      byAllowance = runScenario('allowance', treatment);
    }

    // The allowance must be strictly cheaper to be used; a tie keeps actual expenses.
    const best = byAllowance !== null && byAllowance.tax.liability.lt(byExpenses.tax.liability) ? byAllowance : byExpenses;
    return {
      treatment,
      byExpenses,
      byAllowance,
      allowanceBlockedReason,
      best,
      bestMethod: best === byExpenses ? 'expenses' : 'allowance',
    };
  };

  // ---- Rent-a-room: pooled once, every valid treatment evaluated ----
  const roomPool = poolRentARoom(inputs.properties, rates);
  const evaluations = (roomPool ? roomPool.validTreatments : [null]).map(evaluate);
  const winner = chooseTreatment(evaluations);
  const { byExpenses, byAllowance, allowanceBlockedReason } = winner;
  const chosen = winner.best;
  const method = winner.bestMethod;

  let methodReason: string;
  if (byAllowance === null) {
    methodReason = `Actual expenses used. ${allowanceBlockedReason}`;
  } else if (method === 'allowance') {
    methodReason =
      `Property allowance used: income tax ${formatCurrency(byAllowance.tax.liability)} against ` +
      `${formatCurrency(byExpenses.tax.liability)} with actual expenses.`;
  } else {
    methodReason =
      byAllowance.tax.liability.eq(byExpenses.tax.liability)
        ? `Actual expenses used: income tax is the same (${formatCurrency(byExpenses.tax.liability)}) either way, and expenses keep any loss and finance-cost carry-forwards alive.`
        : `Actual expenses used: income tax ${formatCurrency(byExpenses.tax.liability)} against ` +
          `${formatCurrency(byAllowance.tax.liability)} with the property allowance, which would also give up the S.24 finance-cost reducer.`;
  }

  const methods: MethodComparison[] = evaluations.flatMap(ev => {
    const suffix = ev.treatment ? `, ${TREATMENT_SHORT_LABEL[ev.treatment]}` : '';
    const treatmentNote = ev.treatment ? ` ${TREATMENT_NOTE[ev.treatment]}` : '';
    const isChosen = (m: PropertyMethod) => ev === winner && m === method;
    return [
      describeMethod('expenses', ev.treatment, `Actual expenses${suffix}`, ev.byExpenses, isChosen('expenses'), `Expenses deducted; finance costs earn the S.24 reducer.${treatmentNote}`),
      ev.byAllowance
        ? describeMethod('allowance', ev.treatment, `Property allowance${suffix}`, ev.byAllowance, isChosen('allowance'), `Allowance replaces expenses; no S.24 reducer and no finance-cost carry-forward.${treatmentNote}`)
        : {
            method: 'allowance' as const,
            rentARoom: ev.treatment,
            label: `Property allowance${suffix}`,
            available: false,
            chosen: false,
            propertyProfit: null,
            financeCostReducer: null,
            liability: null,
            note: ev.allowanceBlockedReason ?? 'Not available.',
          },
    ];
  });

  const rentARoomReason = roomPool ? explainRentARoom(roomPool, winner, evaluations) : null;

  // ---- Tax on rental income alone ----
  const withoutProperty = computeIncomeTax({
    rates,
    nonSavingsIncome: nonSavings,
    propertyProfit: 0,
    savingsInterest: savings,
    dividends,
    financeCostsThisYear: 0,
    financeCostsBroughtForward: 0,
    reliefAtSourcePensionGross: reliefAtSourceGross,
  });
  const taxOnRental = Decimal.max(chosen.tax.liability.minus(withoutProperty.liability), 0);

  // ---- Self Assessment ----
  const liability = chosen.tax.liability;
  const balance = liability.minus(payeTaxPaid);
  const startYear = parseTaxYearLabel(taxYear);
  const deadline = `${startYear + 2}-01-31`;
  const collectedPct = liability.gt(0) ? payeTaxPaid.div(liability).mul(100) : new Decimal(100);

  // Payments on account are due only when the balance is at least £1,000
  // AND no more than 80% of the liability was collected at source (gov.uk:
  // "less than £1,000" or "more than 80% already paid" means none). Each of
  // the two payments is half the balance, due 31 Jan after the year ends
  // and the following 31 Jul, and counts towards the NEXT year's bill.
  const balanceBigEnough = balance.gte(PAYMENTS_ON_ACCOUNT.minimumBalance);
  const mostlyCollected = collectedPct.gt(PAYMENTS_ON_ACCOUNT.maxCollectedAtSourcePct);
  const poaRequired = balanceBigEnough && !mostlyCollected;
  const poaReason = poaRequired
    ? `Balance ${formatCurrency(balance)} is at least ${formatCurrency(PAYMENTS_ON_ACCOUNT.minimumBalance)} and only ${collectedPct.toDecimalPlaces(1)}% of the tax was collected at source (limit ${PAYMENTS_ON_ACCOUNT.maxCollectedAtSourcePct}%).`
    : !balanceBigEnough
      ? `Not required: the balance ${formatCurrency(Decimal.max(balance, 0))} is under ${formatCurrency(PAYMENTS_ON_ACCOUNT.minimumBalance)}.`
      : `Not required: ${collectedPct.toDecimalPlaces(1)}% of the tax was collected at source, more than ${PAYMENTS_ON_ACCOUNT.maxCollectedAtSourcePct}%.`;
  const instalments: PaymentOnAccount[] = [];
  let firstPayment = new Decimal(0);
  if (poaRequired) {
    firstPayment = round2(balance.div(2));
    instalments.push(
      { dueDate: deadline, amount: fixed2(firstPayment) },
      { dueDate: `${startYear + 2}-07-31`, amount: fixed2(balance.minus(firstPayment)) },
    );
  }
  const dueOnDeadline = Decimal.max(balance, 0).plus(firstPayment);

  // ---- MTD ITSA ----
  // A property whose receipts net to a refund contributes nothing, not a negative.
  const propertyReceipts = inputs.properties.reduce(
    (acc, p) => acc.plus(Decimal.max(signedMoney(p.grossIncome, `${p.name} gross income`), 0)),
    new Decimal(0),
  );
  const mtd = computeMtdItsaStatus({
    taxYear,
    propertyReceipts,
    selfEmploymentReceipts: selfEmployment,
  });

  // ---- Warnings ----
  const warnings: string[] = [...pensionWarnings];
  if (ratesAssumed) {
    warnings.push(`No rate table exists for ${taxYear}; ${rates.taxYear} rates were used instead. Treat the figures as a rough guide.`);
  }
  if (rates.provisional) {
    warnings.push(`${rates.taxYear} rates are provisional: ${rates.provisionalNotes.join(' ')}`);
  }
  for (const p of inputs.properties) {
    const expenses = signedMoney(p.totalExpenses, `${p.name} expenses`);
    const interest = signedMoney(p.mortgageInterest, `${p.name} mortgage interest`);
    if (p.lettingType === 'rent_a_room' && (!expenses.isZero() || interest.gt(0))) {
      // What the figures mean depends on the treatment chosen: the normal
      // method claims them, the exempt and alternative methods ignore them.
      warnings.push(
        `${p.name} is a rent-a-room letting but has recorded expenses or mortgage interest. ` +
          (winner.treatment === 'normal'
            ? 'The normal method is being used, so they count: only the part that relates to the let room is claimable; make sure these figures are already apportioned.'
            : `They are not claimed under the ${winner.treatment} method; only the part that relates to the let room would be claimable under the normal method, so make sure these figures are already apportioned.`),
      );
    }
  }
  if (selfEmployment.gt(0)) {
    warnings.push('Self-employment income is used as profit for tax and as turnover for the MTD test. If it is a profit figure, the MTD test understates turnover.');
  }
  if (balance.isNeg()) {
    warnings.push(`PAYE paid (${formatCurrency(payeTaxPaid)}) exceeds the liability, so a repayment of ${formatCurrency(balance.neg())} is likely.`);
  }
  if (inputs.properties.length === 0) {
    warnings.push('No properties are recorded for this owner, so no rental income is included.');
  }

  // ---- Step-by-step breakdown ----
  const breakdown: BreakdownLine[] = [];
  const add = (section: string, text: string, amount: Decimal | string | null = null) =>
    breakdown.push({ section, text, amount: amount === null ? null : typeof amount === 'string' ? amount : amount.toFixed(2) });

  add(
    'Inputs',
    `Tax year ${taxYear} (6 April ${startYear} to 5 April ${startYear + 1}), ${rates.taxYear} rates for England, Wales and Northern Ireland${ratesAssumed ? ' (assumed)' : ''}${rates.provisional ? ', provisional' : ''}.`,
  );
  add('Inputs', `Employment income ${formatCurrency(employment)}, self-employment ${formatCurrency(selfEmployment)}, other income ${formatCurrency(otherIncome)}.`, nonSavings);
  if (employmentDeduction.gt(0)) {
    add('Pension', `Employee ${pensionMethod === 'salary_sacrifice' ? 'salary sacrifice' : 'net-pay pension deduction'} ${formatCurrency(employmentDeduction)} has been removed from gross employment income once; employment income used is ${formatCurrency(employment.minus(employmentDeduction))}.`, employmentDeduction);
  } else if (pensionApplied && employmentIncomeBasis === 'taxable_pay_after_pension' && pensionMethod !== 'relief_at_source') {
    add('Pension', 'Employment income is already taxable pay after pension deductions; no second pension deduction is made.');
  }
  add('Inputs', `Savings interest ${formatCurrency(savings)}, dividends ${formatCurrency(dividends)}.`);
  add('Inputs', `Tax already paid through PAYE ${formatCurrency(payeTaxPaid)}.`, payeTaxPaid);
  for (const p of inputs.properties) {
    add(
      'Inputs',
      `${p.name} (${p.lettingType === 'rent_a_room' ? 'rent-a-room' : 'standard letting'}), your share: receipts ${formatCurrency(signedMoney(p.grossIncome, 'income'))}, ` +
        `expenses ${formatCurrency(signedMoney(p.totalExpenses, 'expenses'))}, mortgage interest ${formatCurrency(signedMoney(p.mortgageInterest, 'interest'))}.`,
    );
  }

  breakdown.push(...chosen.property.lines);

  if (rentARoomReason) add('Property method', rentARoomReason);
  add('Property method', methodReason);
  for (const m of methods) {
    add(
      'Property method',
      m.available
        ? `${m.label}: property profit ${formatCurrency(m.propertyProfit!)}, S.24 reducer ${formatCurrency(m.financeCostReducer!)}, income tax ${formatCurrency(m.liability!)}.`
        : `${m.label}: not available. ${m.note}`,
      m.liability,
    );
  }

  breakdown.push(...chosen.tax.lines);

  add('Tax on rental income', `Income tax with rental income ${formatCurrency(liability)} less income tax without it ${formatCurrency(withoutProperty.liability)} = ${formatCurrency(taxOnRental)} attributable to rental income.`, taxOnRental);

  add('Self Assessment', `Income tax ${formatCurrency(liability)} less PAYE already paid ${formatCurrency(payeTaxPaid)} = ${balance.isNeg() ? 'repayment of ' + formatCurrency(balance.neg()) : 'balance of ' + formatCurrency(balance)} through Self Assessment, due by ${deadline}.`, balance);
  add('Self Assessment', `Payments on account: ${poaReason}`);
  for (const [i, instalment] of instalments.entries()) {
    add('Self Assessment', `Payment on account ${i + 1} of 2 (towards ${startYear + 1}-${String((startYear + 2) % 100).padStart(2, '0')}), due ${instalment.dueDate}: ${formatCurrency(instalment.amount)}.`, instalment.amount);
  }
  if (poaRequired) {
    add('Self Assessment', `Due on ${deadline}: balance ${formatCurrency(Decimal.max(balance, 0))} plus first payment on account ${formatCurrency(firstPayment)} = ${formatCurrency(dueOnDeadline)}.`, dueOnDeadline);
  }

  add('MTD ITSA', mtd.summary, mtd.qualifyingIncome);

  // ---- Serialise ----
  const reducer = chosen.tax.financeCostReducer;
  return {
    taxYear,
    rates: {
      taxYear: rates.taxYear,
      assumed: ratesAssumed,
      provisional: rates.provisional,
      provisionalNotes: rates.provisionalNotes,
      sources: rates.sources,
    },
    income: {
      nonSavings: fixed2(nonSavings),
      propertyProfit: fixed2(chosen.property.taxableProfit),
      savings: fixed2(savings),
      dividends: fixed2(dividends),
      total: fixed2(chosen.tax.totalIncome),
      adjustedNetIncome: fixed2(chosen.tax.adjustedNetIncome),
    },
    ...(pensionSpecified ? {
      pension: {
        method: pensionMethod,
        employmentIncomeBasis,
        annualEmployeeAmount: pensionAmountKnown ? fixed2(pensionAmount) : null,
        employmentDeduction: fixed2(employmentDeduction),
        reliefAtSourceGross: fixed2(reliefAtSourceGross),
        applied: pensionApplied,
      },
    } : {}),
    property: {
      method,
      methodReason,
      methods,
      standardGrossIncome: fixed2(chosen.property.standard.grossIncome),
      standardExpenses: fixed2(chosen.property.standard.expenses),
      profitByExpenses: fixed2(chosen.property.standard.profitByExpenses),
      profitByAllowance: fixed2(chosen.property.standard.profitByAllowance),
      allowanceRelief: chosen.property.standard.allowanceRelief,
      rentARoom: (chosen.property.rentARoom?.lettings ?? []).map(l => ({
        name: l.name,
        receipts: fixed2(l.receipts),
        expenses: fixed2(l.expenses),
        financeCosts: fixed2(l.financeCosts),
        shared: l.shared,
      })),
      rentARoomPool:
        chosen.property.rentARoom && rentARoomReason
          ? {
              treatment: chosen.property.rentARoom.treatment,
              reason: rentARoomReason,
              limit: fixed2(chosen.property.rentARoom.limit),
              shared: chosen.property.rentARoom.shared,
              receipts: fixed2(chosen.property.rentARoom.receipts),
              expenses: fixed2(chosen.property.rentARoom.expenses),
              financeCosts: fixed2(chosen.property.rentARoom.financeCosts),
              alternativeTaxable: fixed2(chosen.property.rentARoom.alternativeTaxable),
              normalResult: fixed2(chosen.property.rentARoom.normalResult),
              taxable: fixed2(chosen.property.rentARoom.taxable),
            }
          : null,
      currentYearResult: fixed2(chosen.property.currentYearResult),
      lossesBroughtForward: fixed2(chosen.property.lossesBroughtForward),
      lossesUsed: fixed2(chosen.property.lossesUsed),
      taxableProfit: fixed2(chosen.property.taxableProfit),
      lossesCarriedForward: fixed2(chosen.property.lossesCarriedForward),
      hasLosses: chosen.property.lossesBroughtForward.gt(0) || chosen.property.lossesCarriedForward.gt(0),
    },
    financeCosts: {
      claimedThisYear: fixed2(chosen.property.financeCostsClaimed),
      broughtForward: fixed2(financeBroughtForward),
      available: fixed2(reducer.financeCostsAvailable),
      relieved: fixed2(reducer.relievableAmount),
      limitedBy: reducer.limitedBy,
      reliefRatePct: reducer.reliefRatePct.toString(),
      reducer: fixed2(reducer.reducer),
      carriedForward: fixed2(reducer.carriedForward),
      hasFinanceCosts: reducer.financeCostsAvailable.gt(0),
      hasCarriedForward: reducer.carriedForward.gt(0),
    },
    incomeTax: {
      personalAllowance: {
        standard: fixed2(chosen.tax.personalAllowance.standard),
        taperReduction: fixed2(chosen.tax.personalAllowance.taperReduction),
        effective: fixed2(chosen.tax.personalAllowance.effective),
        tapered: chosen.tax.personalAllowance.taperReduction.gt(0),
      },
      rows: chosen.tax.rows.map(r => ({
        layer: r.layer,
        layerLabel: LAYER_LABEL[r.layer],
        kind: r.kind,
        kindLabel: KIND_LABEL[r.kind],
        income: fixed2(r.income),
        ratePct: r.ratePct.toString(),
        tax: fixed2(r.tax),
      })),
      taxBeforeReductions: fixed2(chosen.tax.taxBeforeReductions),
      financeCostReducer: fixed2(reducer.reducer),
      liability: fixed2(liability),
    },
    taxOnRentalIncome: {
      amount: fixed2(taxOnRental),
      liabilityWithProperty: fixed2(liability),
      liabilityWithoutProperty: fixed2(withoutProperty.liability),
    },
    selfAssessment: {
      payeTaxPaid: fixed2(payeTaxPaid),
      balanceDue: fixed2(balance),
      amountDue: fixed2(Decimal.max(balance, 0)),
      refundDue: fixed2(Decimal.max(balance.neg(), 0)),
      isRefund: balance.isNeg(),
      deadline,
      paymentsOnAccount: {
        required: poaRequired,
        reason: poaReason,
        collectedAtSourcePct: collectedPct.toDecimalPlaces(2).toFixed(2),
        instalments,
        dueOnDeadline: fixed2(dueOnDeadline),
      },
    },
    mtd,
    warnings,
    disclaimer: TAX_COMPUTATION_DISCLAIMER,
    breakdown,
  };
}

function describeMethod(
  method: PropertyMethod,
  rentARoom: RentARoomTreatment | null,
  label: string,
  scenario: Scenario,
  chosen: boolean,
  note: string,
): MethodComparison {
  return {
    method,
    rentARoom,
    label,
    available: true,
    chosen,
    propertyProfit: fixed2(scenario.property.taxableProfit),
    financeCostReducer: fixed2(scenario.tax.financeCostReducer.reducer),
    liability: fixed2(scenario.tax.liability),
    note,
  };
}

/**
 * A short reason for the rent-a-room treatment, comparing the chosen one with
 * the other valid treatment(s) on income tax and, on a tie, carry-forward.
 */
function explainRentARoom(pool: RentARoomPool, winner: TreatmentEvaluation, all: TreatmentEvaluation[]): string {
  const treatment = winner.treatment!;
  const tax = winner.best.tax.liability;
  const taxOf = (t: RentARoomTreatment) => all.find(e => e.treatment === t)?.best;
  const limitText = `${formatCurrency(pool.limit)} limit${pool.shared ? ' (halved because a letting is shared)' : ''}`;
  const receipts = formatCurrency(pool.receipts);

  if (treatment === 'exempt') {
    const normal = taxOf('normal')!;
    return (
      `Exempt: pooled receipts ${receipts} are within the single ${limitText}, so the income is exempt. ` +
      (normal.tax.liability.gt(tax)
        ? `Electing out (normal method) would give income tax of ${formatCurrency(normal.tax.liability)} against ${formatCurrency(tax)}.`
        : `Electing out (normal method) would give the same income tax (${formatCurrency(tax)}) and no more loss or finance costs carried forward, so the exemption is kept.`)
    );
  }

  if (treatment === 'normal') {
    const exempt = taxOf('exempt');
    if (exempt) {
      // Receipts are within the limit, so the normal method means electing out.
      const saving = exempt.tax.liability.minus(tax);
      const result = pool.normalResult.isNeg()
        ? `a ${formatCurrency(pool.normalResult.neg())} loss`
        : `a ${formatCurrency(pool.normalResult)} profit`;
      return saving.gt(0)
        ? `Elected out of the exemption: the normal method gives ${result} ${pool.normalResult.isNeg() ? 'that' : 'and'} reduces income tax by ${formatCurrency(saving)} ` +
            `(${formatCurrency(tax)} against ${formatCurrency(exempt.tax.liability)} with the exemption).`
        : `Elected out of the exemption: the normal method gives ${result}. Income tax is the same (${formatCurrency(tax)}), ` +
            `but ${formatCurrency(carryForwardOf(winner.best).minus(carryForwardOf(exempt)))} more loss and finance costs carry forward.`;
    }
    const alternative = taxOf('alternative')!;
    return (
      `Normal method used: pooled receipts ${receipts} exceed the single ${limitText}, and receipts less expenses ` +
      `(finance costs earning the S.24 reducer) ` +
      (alternative.tax.liability.gt(tax)
        ? `give income tax of ${formatCurrency(tax)} against ${formatCurrency(alternative.tax.liability)} with the alternative method, which allows no expenses and no finance-cost relief.`
        : `give the same income tax (${formatCurrency(tax)}) as the alternative method and at least as much loss and finance costs carried forward.`)
    );
  }

  const normal = taxOf('normal')!;
  return (
    `Alternative method used: pooled receipts ${receipts} exceed the single ${limitText}, so only receipts less the limit ` +
    `(${formatCurrency(pool.alternativeTaxable)}) is taxed, with no expenses and no finance-cost relief. ` +
    (normal.tax.liability.gt(tax)
      ? `Income tax ${formatCurrency(tax)} against ${formatCurrency(normal.tax.liability)} with the normal method.`
      : `The normal method gives the same income tax (${formatCurrency(tax)}) but less loss and finance costs carried forward.`)
  );
}
