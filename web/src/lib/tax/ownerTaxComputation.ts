/**
 * One owner's UK income-tax position for one tax year, with the rental
 * income worked through in full. Pure: the repo gathers the per-property
 * owner-share totals and the saved tax profile, this turns them into a
 * result. The output is plain JSON (money as decimal strings, no Decimal
 * instances) so the API, UI, CSV export and AI tool can all use it as is.
 *
 * Flow:
 *   1. Pick the rates for the year (fallback flagged via `rates.assumed`).
 *   2. Work the UK property profit under actual expenses, and, when the
 *      property allowance is available, under the allowance too.
 *   3. Run the full income-tax calculation for each, keep the cheaper
 *      (ties go to actual expenses, which keeps losses and finance costs
 *      alive for later years).
 *   4. Re-run without any property to isolate the tax on rental income.
 *   5. Self Assessment balance, payments on account, MTD ITSA status.
 */

import Decimal from 'decimal.js';
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
import { nonNegativeMoney, round2 } from './moneyInput';
import {
  computePropertyIncome,
  type LettingType,
  type PropertyIncomeResult,
  type PropertyLetting,
  type PropertyMethod,
  type RentARoomOutcome,
} from './propertyTax';
import { PAYMENTS_ON_ACCOUNT, getRatesForTaxYear } from './taxRates';
import { parseTaxYearLabel, taxYearRange } from './ukTaxYear';

export type { LettingType, PropertyLetting, PropertyMethod };

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
}

export interface OwnerTaxInputs {
  taxYear: string;
  /** One entry per property, at the owner's share. */
  properties: PropertyLetting[];
  profile: OwnerTaxProfileInput;
}

export interface MethodComparison {
  method: PropertyMethod;
  label: string;
  available: boolean;
  /** Property profit taxed under this method (after losses); null when not available. */
  propertyProfit: string | null;
  /** S.24 tax reducer under this method; null when not available. */
  financeCostReducer: string | null;
  /** Total income-tax liability under this method; null when not available. */
  liability: string | null;
  note: string;
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
  };
  property: {
    method: PropertyMethod;
    methodReason: string;
    methods: MethodComparison[];
    standardGrossIncome: string;
    standardExpenses: string;
    profitByExpenses: string;
    profitByAllowance: string;
    allowanceRelief: 'full' | 'partial' | 'none';
    rentARoom: Array<{
      name: string;
      receipts: string;
      limit: string;
      shared: boolean;
      outcome: RentARoomOutcome;
      taxable: string;
    }>;
    currentYearResult: string;
    lossesBroughtForward: string;
    lossesUsed: string;
    taxableProfit: string;
    lossesCarriedForward: string;
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
  };
  incomeTax: {
    personalAllowance: { standard: string; taperReduction: string; effective: string };
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

function fixed2(value: Decimal): string {
  return value.toFixed(2);
}

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
  const nonSavings = employment.plus(selfEmployment).plus(otherIncome);

  const runScenario = (method: PropertyMethod): Scenario => {
    const property = computePropertyIncome({
      rates,
      properties: inputs.properties,
      method,
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
    });
    return { property, tax };
  };

  // ---- Choose between actual expenses and the property allowance ----
  const byExpenses = runScenario('expenses');
  const allowanceRelief = byExpenses.property.standard.allowanceRelief;

  let byAllowance: Scenario | null = null;
  let allowanceBlockedReason: string | null = null;
  if (allowanceRelief === 'none') {
    allowanceBlockedReason = 'No standard lettings receipts for the allowance to cover.';
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
    byAllowance = runScenario('allowance');
  }

  let chosen = byExpenses;
  let method: PropertyMethod = 'expenses';
  let methodReason: string;
  if (byAllowance === null) {
    methodReason = `Actual expenses used. ${allowanceBlockedReason}`;
  } else if (byAllowance.tax.liability.lt(byExpenses.tax.liability)) {
    chosen = byAllowance;
    method = 'allowance';
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

  const methods: MethodComparison[] = [
    describeMethod('expenses', 'Actual expenses', byExpenses, true, 'Expenses deducted; finance costs earn the S.24 reducer.'),
    byAllowance
      ? describeMethod('allowance', 'Property allowance', byAllowance, true, 'Allowance replaces expenses; no S.24 reducer and no finance-cost carry-forward.')
      : {
          method: 'allowance',
          label: 'Property allowance',
          available: false,
          propertyProfit: null,
          financeCostReducer: null,
          liability: null,
          note: allowanceBlockedReason ?? 'Not available.',
        },
  ];

  // ---- Tax on rental income alone ----
  const withoutProperty = computeIncomeTax({
    rates,
    nonSavingsIncome: nonSavings,
    propertyProfit: 0,
    savingsInterest: savings,
    dividends,
    financeCostsThisYear: 0,
    financeCostsBroughtForward: 0,
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
  const propertyReceipts = inputs.properties.reduce(
    (acc, p) => acc.plus(nonNegativeMoney(p.grossIncome, `${p.name} gross income`)),
    new Decimal(0),
  );
  const mtd = computeMtdItsaStatus({
    taxYear,
    propertyReceipts,
    selfEmploymentReceipts: selfEmployment,
  });

  // ---- Warnings ----
  const warnings: string[] = [];
  if (ratesAssumed) {
    warnings.push(`No rate table exists for ${taxYear}; ${rates.taxYear} rates were used instead. Treat the figures as a rough guide.`);
  }
  if (rates.provisional) {
    warnings.push(`${rates.taxYear} rates are provisional: ${rates.provisionalNotes.join(' ')}`);
  }
  for (const p of inputs.properties) {
    const expenses = nonNegativeMoney(p.totalExpenses, `${p.name} expenses`);
    const interest = nonNegativeMoney(p.mortgageInterest, `${p.name} mortgage interest`);
    if (p.lettingType === 'rent_a_room' && (expenses.gt(0) || interest.gt(0))) {
      warnings.push(
        `${p.name} is a rent-a-room letting but has recorded expenses or mortgage interest. Only the part that relates to the let room is claimable; make sure these figures are already apportioned.`,
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
  add('Inputs', `Savings interest ${formatCurrency(savings)}, dividends ${formatCurrency(dividends)}.`);
  add('Inputs', `Tax already paid through PAYE ${formatCurrency(payeTaxPaid)}.`, payeTaxPaid);
  for (const p of inputs.properties) {
    add(
      'Inputs',
      `${p.name} (${p.lettingType === 'rent_a_room' ? 'rent-a-room' : 'standard letting'}), your share: receipts ${formatCurrency(nonNegativeMoney(p.grossIncome, 'income'))}, ` +
        `expenses ${formatCurrency(nonNegativeMoney(p.totalExpenses, 'expenses'))}, mortgage interest ${formatCurrency(nonNegativeMoney(p.mortgageInterest, 'interest'))}.`,
    );
  }

  breakdown.push(...chosen.property.lines);

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
    },
    property: {
      method,
      methodReason,
      methods,
      standardGrossIncome: fixed2(chosen.property.standard.grossIncome),
      standardExpenses: fixed2(chosen.property.standard.expenses),
      profitByExpenses: fixed2(chosen.property.standard.profitByExpenses),
      profitByAllowance: fixed2(chosen.property.standard.profitByAllowance),
      allowanceRelief: chosen.property.standard.allowanceRelief,
      rentARoom: chosen.property.rentARoom.map(r => ({
        name: r.name,
        receipts: fixed2(r.receipts),
        limit: fixed2(r.limit),
        shared: r.shared,
        outcome: r.outcome,
        taxable: fixed2(r.taxable),
      })),
      currentYearResult: fixed2(chosen.property.currentYearResult),
      lossesBroughtForward: fixed2(chosen.property.lossesBroughtForward),
      lossesUsed: fixed2(chosen.property.lossesUsed),
      taxableProfit: fixed2(chosen.property.taxableProfit),
      lossesCarriedForward: fixed2(chosen.property.lossesCarriedForward),
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
    },
    incomeTax: {
      personalAllowance: {
        standard: fixed2(chosen.tax.personalAllowance.standard),
        taperReduction: fixed2(chosen.tax.personalAllowance.taperReduction),
        effective: fixed2(chosen.tax.personalAllowance.effective),
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
  label: string,
  scenario: Scenario,
  available: boolean,
  note: string,
): MethodComparison {
  return {
    method,
    label,
    available,
    propertyProfit: fixed2(scenario.property.taxableProfit),
    financeCostReducer: fixed2(scenario.tax.financeCostReducer.reducer),
    liability: fixed2(scenario.tax.liability),
    note,
  };
}
