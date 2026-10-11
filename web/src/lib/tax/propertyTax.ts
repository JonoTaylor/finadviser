/**
 * UK property profit for one owner and one tax year, at the owner's share.
 *
 * Two kinds of letting, kept apart because HMRC treats them differently:
 *
 *   standard      Ordinary lettings. All of them pool into ONE UK property
 *                 business: profit = receipts less allowable expenses, OR
 *                 receipts less the £1,000 property allowance (HMRC "partial
 *                 relief": no expenses and no loss; "full relief" nil profit
 *                 when receipts are £1,000 or less).
 *   rent_a_room   Letting furnished space in the owner's own home. Receipts
 *                 up to the limit (£7,500, or £3,750 when someone else also
 *                 receives income from the same home) are exempt. Over the
 *                 limit the owner takes the lower of
 *                   alternative method: receipts - limit, no expenses
 *                   normal method:      receipts - expenses
 *                 Rent-a-room receipts are not "relievable receipts" for
 *                 the property allowance, so the two never overlap.
 *
 * The caller chooses `method` (expenses vs property allowance) for the
 * standard pool. It is deliberately NOT chosen here by comparing profits,
 * because the allowance is an alternative to the S.24 finance-cost reducer
 * too (HMRC PIM4460): picking it forfeits the reducer and creates no
 * carry-forward of finance costs. The orchestrator therefore compares total
 * tax under both methods.
 *
 * Finance costs (mortgage interest) are never deducted from profit: S.24
 * turns them into a basic-rate tax reducer, worked out in incomeTax.ts. All
 * mortgage interest is treated as residential, i.e. restricted.
 */

import Decimal from 'decimal.js';
import { formatCurrency } from '@/lib/utils/formatting';
import type { BreakdownLine } from './breakdown';
import { nonNegativeMoney, signedMoney } from './moneyInput';
import type { TaxRateTable } from './taxRates';

export type LettingType = 'standard' | 'rent_a_room';
export type PropertyMethod = 'expenses' | 'allowance';

const SECTION = 'Property income';

export interface PropertyLetting {
  name: string;
  lettingType: LettingType;
  // The three money figures come from the ledger and may be negative when
  // refunds exceed charges in the year (a net expense recovery simply adds
  // to profit). Mortgage interest is floored at zero: a net interest refund
  // is not a finance cost.
  /** Owner's share of gross receipts. */
  grossIncome: Decimal.Value;
  /** Owner's share of allowable expenses, EXCLUDING finance costs. */
  totalExpenses: Decimal.Value;
  /** Owner's share of mortgage interest (finance costs). */
  mortgageInterest: Decimal.Value;
  /**
   * rent_a_room only: another person also receives income from letting in
   * the same home, so the limit is halved.
   */
  rentARoomShared?: boolean;
}

export interface PropertyIncomeInputs {
  rates: TaxRateTable;
  properties: PropertyLetting[];
  method: PropertyMethod;
  lossesBroughtForward: Decimal.Value;
}

export type RentARoomOutcome = 'exempt' | 'alternative' | 'normal';

export interface RentARoomResult {
  name: string;
  receipts: Decimal;
  limit: Decimal;
  shared: boolean;
  outcome: RentARoomOutcome;
  /** receipts - limit, floored at 0. */
  alternativeTaxable: Decimal;
  /** receipts - expenses; negative when expenses exceed receipts. */
  normalResult: Decimal;
  /** Amount added to the property business this year. Negative = a loss. */
  taxable: Decimal;
  /** Finance costs that go into the S.24 pool (only under the normal method). */
  financeCosts: Decimal;
}

export interface StandardPoolResult {
  grossIncome: Decimal;
  expenses: Decimal;
  financeCosts: Decimal;
  profitByExpenses: Decimal;
  /** max(0, receipts - allowance): partial relief cannot create a loss. */
  profitByAllowance: Decimal;
  /** 'none' when there are no standard receipts for the allowance to cover. */
  allowanceRelief: 'full' | 'partial' | 'none';
  /** Result under the chosen method. */
  result: Decimal;
}

export interface PropertyIncomeResult {
  method: PropertyMethod;
  standard: StandardPoolResult;
  rentARoom: RentARoomResult[];
  /** Standard result plus rent-a-room amounts, before losses. */
  currentYearResult: Decimal;
  lossesBroughtForward: Decimal;
  lossesUsed: Decimal;
  /** Property profit that goes into the tax computation. Never negative. */
  taxableProfit: Decimal;
  lossesCarriedForward: Decimal;
  /**
   * Finance costs that enter the S.24 reducer this year. Zero under the
   * allowance method, which forfeits finance-cost relief for the year.
   */
  financeCostsClaimed: Decimal;
  /** Finance costs incurred this year but given no relief (allowance method, or rent-a-room not on the normal method). */
  financeCostsUnclaimed: Decimal;
  lines: BreakdownLine[];
}

function financeCostsOf(p: PropertyLetting): Decimal {
  return Decimal.max(signedMoney(p.mortgageInterest, `${p.name} mortgage interest`), 0);
}

export function computePropertyIncome(inputs: PropertyIncomeInputs): PropertyIncomeResult {
  const { rates, method } = inputs;
  const lossesBroughtForward = nonNegativeMoney(inputs.lossesBroughtForward, 'Property losses brought forward');

  const lines: BreakdownLine[] = [];
  const addLine = (text: string, amount: Decimal | null = null) =>
    lines.push({ section: SECTION, text, amount: amount ? amount.toFixed(2) : null });

  // ---- Standard lettings: one pooled UK property business ----
  let stdGross = new Decimal(0);
  let stdExpenses = new Decimal(0);
  let stdFinance = new Decimal(0);
  const standardNames: string[] = [];
  for (const p of inputs.properties) {
    if (p.lettingType !== 'standard') continue;
    standardNames.push(p.name);
    stdGross = stdGross.plus(signedMoney(p.grossIncome, `${p.name} gross income`));
    stdExpenses = stdExpenses.plus(signedMoney(p.totalExpenses, `${p.name} expenses`));
    stdFinance = stdFinance.plus(financeCostsOf(p));
  }

  const profitByExpenses = stdGross.minus(stdExpenses);
  const profitByAllowance = Decimal.max(stdGross.minus(rates.propertyAllowance), 0);
  const allowanceRelief: StandardPoolResult['allowanceRelief'] = stdGross.lte(0)
    ? 'none'
    : stdGross.lte(rates.propertyAllowance)
      ? 'full'
      : 'partial';
  const stdResult = method === 'allowance' ? profitByAllowance : profitByExpenses;

  if (standardNames.length > 0) {
    const who = standardNames.join(', ');
    if (method === 'expenses') {
      addLine(
        `Standard lettings (${who}) on actual expenses: receipts ${formatCurrency(stdGross)} less expenses ${formatCurrency(stdExpenses)} = ` +
          `${profitByExpenses.isNeg() ? 'loss of ' + formatCurrency(profitByExpenses.neg()) : 'profit of ' + formatCurrency(profitByExpenses)}.`,
        profitByExpenses,
      );
    } else if (allowanceRelief === 'full') {
      addLine(
        `Standard lettings (${who}) with the property allowance: receipts ${formatCurrency(stdGross)} are within the ` +
          `${formatCurrency(rates.propertyAllowance)} allowance (full relief), so the profit is nil. No expenses or finance-cost relief are claimed.`,
        profitByAllowance,
      );
    } else {
      addLine(
        `Standard lettings (${who}) with the property allowance: receipts ${formatCurrency(stdGross)} less the ` +
          `${formatCurrency(rates.propertyAllowance)} allowance (partial relief) = profit of ${formatCurrency(profitByAllowance)}. ` +
          `No expenses or finance-cost relief are claimed.`,
        profitByAllowance,
      );
    }
  }

  // ---- Rent-a-room: each property on its own ----
  const rentARoom: RentARoomResult[] = [];
  for (const p of inputs.properties) {
    if (p.lettingType !== 'rent_a_room') continue;
    const receipts = signedMoney(p.grossIncome, `${p.name} gross income`);
    const expenses = signedMoney(p.totalExpenses, `${p.name} expenses`);
    const finance = financeCostsOf(p);
    const shared = Boolean(p.rentARoomShared);
    const limit = shared ? rates.rentARoomLimit.div(2) : rates.rentARoomLimit;

    const alternativeTaxable = Decimal.max(receipts.minus(limit), 0);
    const normalResult = receipts.minus(expenses);

    let outcome: RentARoomOutcome;
    let taxable: Decimal;
    if (receipts.lte(limit)) {
      outcome = 'exempt';
      taxable = new Decimal(0);
    } else if (normalResult.lt(alternativeTaxable)) {
      outcome = 'normal';
      taxable = normalResult;
    } else {
      outcome = 'alternative';
      taxable = alternativeTaxable;
    }

    rentARoom.push({
      name: p.name,
      receipts,
      limit,
      shared,
      outcome,
      alternativeTaxable,
      normalResult,
      taxable,
      financeCosts: outcome === 'normal' ? finance : new Decimal(0),
    });

    const limitText = `${formatCurrency(limit)}${shared ? ' (halved because the letting is shared)' : ''}`;
    if (outcome === 'exempt') {
      addLine(
        `Rent-a-room (${p.name}): receipts ${formatCurrency(receipts)} are within the limit of ${limitText}, so the income is exempt.`,
        taxable,
      );
    } else if (outcome === 'alternative') {
      addLine(
        `Rent-a-room (${p.name}): receipts ${formatCurrency(receipts)} exceed the limit of ${limitText}. ` +
          `Alternative method (receipts less limit, no expenses) = ${formatCurrency(alternativeTaxable)}, lower than the normal method ` +
          `(receipts less expenses ${formatCurrency(expenses)}) = ${formatCurrency(normalResult)}, so the alternative method is used.`,
        taxable,
      );
    } else {
      addLine(
        `Rent-a-room (${p.name}): receipts ${formatCurrency(receipts)} exceed the limit of ${limitText}. ` +
          `Normal method (receipts less expenses ${formatCurrency(expenses)}) = ${formatCurrency(normalResult)}, lower than the alternative ` +
          `method (receipts less limit) = ${formatCurrency(alternativeTaxable)}, so the normal method is used.`,
        taxable,
      );
    }
  }

  // ---- Combine, then apply losses ----
  const rentARoomTaxable = rentARoom.reduce((acc, r) => acc.plus(r.taxable), new Decimal(0));
  const currentYearResult = stdResult.plus(rentARoomTaxable);

  let lossesUsed = new Decimal(0);
  let taxableProfit: Decimal;
  let lossesCarriedForward: Decimal;
  if (currentYearResult.isNeg()) {
    taxableProfit = new Decimal(0);
    lossesCarriedForward = lossesBroughtForward.plus(currentYearResult.neg());
    addLine(
      `UK property business made a loss of ${formatCurrency(currentYearResult.neg())} this year; no property profit is taxed. ` +
        `Losses carried forward: ${formatCurrency(lossesCarriedForward)}.`,
      currentYearResult,
    );
  } else {
    lossesUsed = Decimal.min(lossesBroughtForward, currentYearResult);
    taxableProfit = currentYearResult.minus(lossesUsed);
    lossesCarriedForward = lossesBroughtForward.minus(lossesUsed);
    if (lossesBroughtForward.gt(0)) {
      addLine(
        `Losses brought forward ${formatCurrency(lossesBroughtForward)}: ${formatCurrency(lossesUsed)} set against this year's profit ` +
          `of ${formatCurrency(currentYearResult)}, leaving ${formatCurrency(lossesCarriedForward)} to carry forward.`,
        lossesUsed,
      );
    }
    addLine(`Taxable UK property profit ${formatCurrency(taxableProfit)}.`, taxableProfit);
  }

  // ---- Finance costs entering the S.24 pool ----
  const rentARoomFinance = rentARoom.reduce((acc, r) => acc.plus(r.financeCosts), new Decimal(0));
  const totalFinanceIncurred = inputs.properties.reduce(
    (acc, p) => acc.plus(financeCostsOf(p)),
    new Decimal(0),
  );
  const financeCostsClaimed = method === 'allowance' ? new Decimal(0) : stdFinance.plus(rentARoomFinance);
  const financeCostsUnclaimed = totalFinanceIncurred.minus(financeCostsClaimed);
  if (totalFinanceIncurred.gt(0)) {
    if (method === 'allowance') {
      addLine(
        `Finance costs ${formatCurrency(totalFinanceIncurred)} get no relief and create no carry-forward because the property allowance was used.`,
        financeCostsUnclaimed,
      );
    } else {
      addLine(
        `Finance costs ${formatCurrency(financeCostsClaimed)} go into the S.24 reducer (they are not deducted from profit).` +
          (financeCostsUnclaimed.gt(0)
            ? ` A further ${formatCurrency(financeCostsUnclaimed)} on rent-a-room homes is not claimed because the exempt or alternative method allows no expenses.`
            : ''),
        financeCostsClaimed,
      );
    }
  }

  return {
    method,
    standard: {
      grossIncome: stdGross,
      expenses: stdExpenses,
      financeCosts: stdFinance,
      profitByExpenses,
      profitByAllowance,
      allowanceRelief,
      result: stdResult,
    },
    rentARoom,
    currentYearResult,
    lossesBroughtForward,
    lossesUsed,
    taxableProfit,
    lossesCarriedForward,
    financeCostsClaimed,
    financeCostsUnclaimed,
    lines,
  };
}
