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
 *   rent_a_room   Letting furnished space in the owner's own home. The
 *                 rent-a-room limit (£7,500, or £3,750 when someone else also
 *                 receives income from the same home) belongs to the
 *                 INDIVIDUAL for the tax year, not to each property (HMRC
 *                 PIM4010). So every rent_a_room letting is pooled into ONE
 *                 rent-a-room computation (total receipts, total expenses,
 *                 total finance costs) and the single limit is applied to
 *                 the total. See `poolRentARoom`.
 *
 * The pooled rent-a-room lettings are handled under one of three TREATMENTS,
 * which the caller chooses (it is deliberately not chosen here, see below):
 *
 *   exempt        Only when pooled receipts <= the limit. The income is
 *                 exempt: nothing is taxed, and no expenses or finance costs
 *                 are claimed (PIM4020: the exemption is automatic).
 *   alternative   Only when pooled receipts > the limit. Taxed on receipts -
 *                 limit with NO expenses and NO finance-cost relief
 *                 (PIM4030). The property allowance cannot apply to these
 *                 receipts; it applies only to the standard pool.
 *   normal        Always possible: the taxpayer elects out of the exemption
 *                 (PIM4020), or simply doesn't use the scheme over the limit.
 *                 The rent-a-room receipts and expenses join the ordinary
 *                 property-business pool, so a loss pools with standard
 *                 profit or carries forward exactly like a standard letting,
 *                 their finance costs join the S.24 pool, and the property
 *                 allowance comparison then covers the merged pool (outside
 *                 the scheme they are ordinary property income).
 *
 * The caller chooses `method` (expenses vs property allowance) for the
 * property-business pool and the rent-a-room `rentARoomTreatment`. Neither is
 * chosen here by comparing profits, because both are really decided by the
 * final tax: the allowance and the exempt/alternative methods forfeit the
 * S.24 finance-cost reducer and its carry-forward (HMRC PIM4460, PIM4030),
 * which a profit comparison cannot see. The orchestrator therefore runs every
 * valid combination through the full income-tax calculation.
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

export type RentARoomTreatment = 'exempt' | 'alternative' | 'normal';

export interface PropertyIncomeInputs {
  rates: TaxRateTable;
  properties: PropertyLetting[];
  method: PropertyMethod;
  /**
   * How the pooled rent_a_room lettings are treated. Ignored when there are
   * none. When omitted it is HMRC's default: exempt if the pooled receipts
   * are within the limit, otherwise the normal method.
   */
  rentARoomTreatment?: RentARoomTreatment;
  lossesBroughtForward: Decimal.Value;
}

export interface RentARoomLetting {
  name: string;
  receipts: Decimal;
  /** Allowable expenses, EXCLUDING finance costs. */
  expenses: Decimal;
  /** Mortgage interest, floored at zero. */
  financeCosts: Decimal;
  shared: boolean;
}

/** All of an owner's rent_a_room lettings as ONE computation (PIM4010). */
export interface RentARoomPool {
  lettings: RentARoomLetting[];
  receipts: Decimal;
  /** Total expenses, EXCLUDING finance costs. */
  expenses: Decimal;
  financeCosts: Decimal;
  /** True when ANY pooled letting is shared (which halves the limit for the pool). */
  shared: boolean;
  /** The single limit that applies to the pooled receipts. */
  limit: Decimal;
  /** receipts - limit, floored at 0: what the alternative method would tax. */
  alternativeTaxable: Decimal;
  /** receipts - expenses; negative when expenses exceed receipts. */
  normalResult: Decimal;
  /** The treatments that may be used, in tie-break preference order. */
  validTreatments: RentARoomTreatment[];
}

export interface RentARoomResult extends RentARoomPool {
  treatment: RentARoomTreatment;
  /**
   * What the rent-a-room lettings add to the UK property business result
   * this year, before losses; negative = a loss. Exempt: nil. Alternative:
   * receipts - limit. Normal: how much the merged pool's result moves by
   * (receipts - expenses on actual expenses).
   */
  taxable: Decimal;
  /** Finance costs that go into the S.24 pool (only under the normal method). */
  financeCostsClaimed: Decimal;
}

export interface StandardPoolResult {
  /** Receipts of the pool: standard lettings, plus the rent-a-room lettings under the normal treatment. */
  grossIncome: Decimal;
  expenses: Decimal;
  financeCosts: Decimal;
  /** True when the pool also holds the rent-a-room lettings (normal treatment). */
  includesRentARoom: boolean;
  profitByExpenses: Decimal;
  /** max(0, receipts - allowance): partial relief cannot create a loss. */
  profitByAllowance: Decimal;
  /** 'none' when there are no receipts in the pool for the allowance to cover. */
  allowanceRelief: 'full' | 'partial' | 'none';
  /** Result under the chosen method. */
  result: Decimal;
}

export interface PropertyIncomeResult {
  method: PropertyMethod;
  standard: StandardPoolResult;
  /** The pooled rent-a-room computation; null when the owner has no rent_a_room lettings. */
  rentARoom: RentARoomResult | null;
  /** Property-business result plus any alternative-method amount, before losses. */
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
  /** Finance costs incurred this year but given no relief (allowance method, or rent-a-room not on the normal treatment). */
  financeCostsUnclaimed: Decimal;
  lines: BreakdownLine[];
}

function financeCostsOf(p: PropertyLetting): Decimal {
  return Decimal.max(signedMoney(p.mortgageInterest, `${p.name} mortgage interest`), 0);
}

/**
 * Pool all of the owner's rent_a_room lettings into ONE computation and work
 * out the single limit that applies to it. Null when there are none.
 *
 * The limit belongs to the individual for the tax year, not to each property
 * (HMRC PIM4010), so two homes with £5,000 each are NOT both exempt: pooled
 * receipts of £10,000 exceed one £7,500 limit.
 *
 * Simplification, deliberately conservative: the limit is halved if ANY of
 * the pooled lettings is shared, otherwise it is the full amount. HMRC's
 * treatment of one person with a shared home and an unshared home is not
 * modelled, and halving for the whole pool can only make more income taxable,
 * never less, so it never understates the tax due.
 */
export function poolRentARoom(properties: PropertyLetting[], rates: TaxRateTable): RentARoomPool | null {
  const lettings: RentARoomLetting[] = [];
  for (const p of properties) {
    if (p.lettingType !== 'rent_a_room') continue;
    lettings.push({
      name: p.name,
      receipts: signedMoney(p.grossIncome, `${p.name} gross income`),
      expenses: signedMoney(p.totalExpenses, `${p.name} expenses`),
      financeCosts: financeCostsOf(p),
      shared: Boolean(p.rentARoomShared),
    });
  }
  if (lettings.length === 0) return null;

  const sum = (pick: (l: RentARoomLetting) => Decimal) =>
    lettings.reduce((acc, l) => acc.plus(pick(l)), new Decimal(0));
  const receipts = sum(l => l.receipts);
  const expenses = sum(l => l.expenses);
  const financeCosts = sum(l => l.financeCosts);
  const shared = lettings.some(l => l.shared);
  const limit = shared ? rates.rentARoomLimit.div(2) : rates.rentARoomLimit;

  return {
    lettings,
    receipts,
    expenses,
    financeCosts,
    shared,
    limit,
    alternativeTaxable: Decimal.max(receipts.minus(limit), 0),
    normalResult: receipts.minus(expenses),
    // Exempt only within the limit; alternative only over it; normal always.
    // Listed in the order the orchestrator prefers them on an exact tie:
    // exempt over normal over alternative.
    validTreatments: receipts.lte(limit) ? ['exempt', 'normal'] : ['normal', 'alternative'],
  };
}

export function computePropertyIncome(inputs: PropertyIncomeInputs): PropertyIncomeResult {
  const { rates, method } = inputs;
  const lossesBroughtForward = nonNegativeMoney(inputs.lossesBroughtForward, 'Property losses brought forward');

  const lines: BreakdownLine[] = [];
  const addLine = (text: string, amount: Decimal | null = null) =>
    lines.push({ section: SECTION, text, amount: amount ? amount.toFixed(2) : null });

  // ---- Rent-a-room: one pooled computation, one treatment ----
  const pool = poolRentARoom(inputs.properties, rates);
  let treatment: RentARoomTreatment | null = null;
  if (pool) {
    treatment = inputs.rentARoomTreatment ?? pool.validTreatments[0];
    if (!pool.validTreatments.includes(treatment)) {
      throw new Error(
        `Rent-a-room treatment '${treatment}' is not valid for pooled receipts of ${pool.receipts.toFixed(2)} ` +
          `against a limit of ${pool.limit.toFixed(2)} (valid: ${pool.validTreatments.join(', ')})`,
      );
    }
  }
  // Under the normal treatment the rent-a-room lettings are ordinary property
  // income and join the pool the expenses/allowance choice applies to.
  const roomInPool = pool !== null && treatment === 'normal';

  // ---- The property-business pool ----
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

  const standardOnlyResult =
    method === 'allowance'
      ? Decimal.max(stdGross.minus(rates.propertyAllowance), 0)
      : stdGross.minus(stdExpenses);

  let poolGross = stdGross;
  let poolExpenses = stdExpenses;
  let poolFinance = stdFinance;
  const poolNames = [...standardNames];
  if (roomInPool) {
    poolGross = poolGross.plus(pool.receipts);
    poolExpenses = poolExpenses.plus(pool.expenses);
    poolFinance = poolFinance.plus(pool.financeCosts);
    poolNames.push(...pool.lettings.map(l => `${l.name} [rent-a-room, outside the scheme]`));
  }

  const profitByExpenses = poolGross.minus(poolExpenses);
  const profitByAllowance = Decimal.max(poolGross.minus(rates.propertyAllowance), 0);
  const allowanceRelief: StandardPoolResult['allowanceRelief'] = poolGross.lte(0)
    ? 'none'
    : poolGross.lte(rates.propertyAllowance)
      ? 'full'
      : 'partial';
  const stdResult = method === 'allowance' ? profitByAllowance : profitByExpenses;

  if (poolNames.length > 0) {
    const who = poolNames.join(', ');
    const what = roomInPool ? 'Property business' : 'Standard lettings';
    if (method === 'expenses') {
      addLine(
        `${what} (${who}) on actual expenses: receipts ${formatCurrency(poolGross)} less expenses ${formatCurrency(poolExpenses)} = ` +
          `${profitByExpenses.isNeg() ? 'loss of ' + formatCurrency(profitByExpenses.neg()) : 'profit of ' + formatCurrency(profitByExpenses)}.`,
        profitByExpenses,
      );
    } else if (allowanceRelief === 'full') {
      addLine(
        `${what} (${who}) with the property allowance: receipts ${formatCurrency(poolGross)} are within the ` +
          `${formatCurrency(rates.propertyAllowance)} allowance (full relief), so the profit is nil. No expenses or finance-cost relief are claimed.`,
        profitByAllowance,
      );
    } else {
      addLine(
        `${what} (${who}) with the property allowance: receipts ${formatCurrency(poolGross)} less the ` +
          `${formatCurrency(rates.propertyAllowance)} allowance (partial relief) = profit of ${formatCurrency(profitByAllowance)}. ` +
          `No expenses or finance-cost relief are claimed.`,
        profitByAllowance,
      );
    }
  }

  // ---- Rent-a-room: the pooled lettings under the chosen treatment ----
  let rentARoom: RentARoomResult | null = null;
  let separateRoomTaxable = new Decimal(0); // added outside the pool (alternative method only)
  if (pool && treatment) {
    for (const l of pool.lettings) {
      addLine(
        `Rent-a-room (${l.name}): receipts ${formatCurrency(l.receipts)}, expenses ${formatCurrency(l.expenses)}, ` +
          `mortgage interest ${formatCurrency(l.financeCosts)}${l.shared ? ', shared' : ''}; pooled with the owner's other rent-a-room lettings.`,
        l.receipts,
      );
    }
    const sharedText = pool.shared
      ? pool.lettings.length === 1
        ? ' (halved because the letting is shared)'
        : ' (halved because at least one of the lettings is shared)'
      : '';
    const limitText = `${formatCurrency(pool.limit)}${sharedText}`;
    const whole = pool.lettings.length > 1 ? `Rent-a-room, all ${pool.lettings.length} lettings together` : 'Rent-a-room';

    let taxable: Decimal;
    if (treatment === 'exempt') {
      taxable = new Decimal(0);
      const unclaimed = pool.expenses.gt(0) || pool.financeCosts.gt(0);
      addLine(
        `${whole}: receipts ${formatCurrency(pool.receipts)} are within the single limit of ${limitText}, so the income is exempt.` +
          (unclaimed ? ' The expenses and finance costs on these lettings are not claimed.' : ''),
        taxable,
      );
    } else if (treatment === 'alternative') {
      taxable = pool.alternativeTaxable;
      separateRoomTaxable = taxable;
      addLine(
        `${whole}: receipts ${formatCurrency(pool.receipts)} exceed the single limit of ${limitText}. ` +
          `Alternative method (receipts less limit, no expenses and no finance-cost relief) = ${formatCurrency(taxable)} added to property profit.`,
        taxable,
      );
    } else {
      taxable = stdResult.minus(standardOnlyResult);
      addLine(
        `${whole}: ${pool.receipts.lte(pool.limit) ? 'the exemption is not used (elected out)' : `receipts ${formatCurrency(pool.receipts)} exceed the single limit of ${limitText}`}. ` +
          `Normal method: receipts ${formatCurrency(pool.receipts)} less expenses ${formatCurrency(pool.expenses)} = ` +
          `${pool.normalResult.isNeg() ? 'loss of ' + formatCurrency(pool.normalResult.neg()) : 'profit of ' + formatCurrency(pool.normalResult)}, ` +
          `pooled with the property business above` +
          `${method === 'allowance' ? ', where the property allowance now covers these receipts too' : ''}.`,
        taxable,
      );
    }

    rentARoom = {
      ...pool,
      treatment,
      taxable,
      financeCostsClaimed: roomInPool && method !== 'allowance' ? pool.financeCosts : new Decimal(0),
    };
  }

  // ---- Combine, then apply losses ----
  const currentYearResult = stdResult.plus(separateRoomTaxable);

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
  // Standard finance costs, plus the rent-a-room ones when they are in the pool
  // (normal treatment). The allowance forfeits all of what the pool holds.
  const totalFinanceIncurred = inputs.properties.reduce(
    (acc, p) => acc.plus(financeCostsOf(p)),
    new Decimal(0),
  );
  const financeCostsClaimed = method === 'allowance' ? new Decimal(0) : poolFinance;
  const financeCostsUnclaimed = totalFinanceIncurred.minus(financeCostsClaimed);
  const roomOutsidePool = totalFinanceIncurred.minus(poolFinance);
  if (totalFinanceIncurred.gt(0)) {
    const roomNote = roomOutsidePool.gt(0)
      ? `A further ${formatCurrency(roomOutsidePool)} on rent-a-room homes is not claimed because the exempt or alternative method allows no expenses.`
      : '';
    if (method === 'allowance') {
      addLine(
        (poolFinance.gt(0)
          ? `Finance costs ${formatCurrency(poolFinance)} get no relief and create no carry-forward because the property allowance was used.`
          : '') + (poolFinance.gt(0) && roomNote ? ' ' : '') + roomNote,
        financeCostsUnclaimed,
      );
    } else {
      addLine(
        `Finance costs ${formatCurrency(financeCostsClaimed)} go into the S.24 reducer (they are not deducted from profit).` +
          (roomNote ? ` ${roomNote}` : ''),
        financeCostsClaimed,
      );
    }
  }

  return {
    method,
    standard: {
      grossIncome: poolGross,
      expenses: poolExpenses,
      financeCosts: poolFinance,
      includesRentARoom: roomInPool,
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
