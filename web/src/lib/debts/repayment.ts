import Decimal from 'decimal.js';
import { debtDateSchema, type ResolvedDebt } from './types';

export type RepaymentStrategy = 'avalanche' | 'snowball';
export interface RepaymentMonth {
  month: number; date: string; openingBalance: string; interest: string;
  payment: string; closingBalance: string;
  payments: Array<{ id: string; name: string; amount: string; interest: string; remaining: string }>;
}
export interface DebtRepaymentResult {
  strategy: RepaymentStrategy;
  status: 'paid_off' | 'incomplete' | 'attention_required' | 'insufficient_budget' | 'negative_amortization' | 'timeline_limit';
  startingBalance: string; monthlyBudget: string; totalInterest: string | null;
  totalPaid: string | null; months: number | null; payoffDate: string | null;
  requiredMinimum: string | null; missingInputs: string[]; warnings: string[];
  schedule: RepaymentMonth[]; methodology: string[];
}
interface RepaymentInput {
  debts: ResolvedDebt[]; monthlyBudget: string; asOf: string; strategy: RepaymentStrategy; maxMonths?: number;
}

/** Preserve the original payment day; e.g. 31 Jan → 28 Feb → 31 Mar. */
export function monthlyPaymentDate(asOf: string, months: number): string {
  debtDateSchema.parse(asOf);
  const [year, month, day] = asOf.split('-').map(Number);
  const end = new Date(Date.UTC(year, month + months, 0)).getUTCDate();
  return new Date(Date.UTC(year, month - 1 + months, Math.min(day, end))).toISOString().slice(0, 10);
}

const daysBetween = (start: string, end: string) => (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000;
const money = (amount: Decimal) => amount.toFixed(2);
function rateOn(debt: ResolvedDebt, date: string): Decimal {
  return new Decimal(debt.promotionalApr !== null && debt.promotionalExpiresOn !== null && date < debt.promotionalExpiresOn ? debt.promotionalApr : debt.apr!);
}
function monthlyInterest(debt: ResolvedDebt, balance: Decimal, start: string, end: string): Decimal {
  let interest = new Decimal(0);
  const expiry = debt.promotionalExpiresOn;
  if (expiry !== null && debt.promotionalApr !== null && expiry > start && expiry < end) {
    interest = balance.times(debt.promotionalApr).div(100).times(daysBetween(start, expiry)).div(365)
      .plus(balance.times(debt.apr!).div(100).times(daysBetween(expiry, end)).div(365));
  } else {
    interest = balance.times(rateOn(debt, start)).div(100).times(daysBetween(start, end)).div(365);
  }
  return interest.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** Deterministic illustration only: no ledger mutation and no invented interest rate or minimum. */
export function analyzeDebtRepayment(input: RepaymentInput): DebtRepaymentResult {
  debtDateSchema.parse(input.asOf);
  if (!/^\d+(\.\d{1,2})?$/.test(input.monthlyBudget) || new Decimal(input.monthlyBudget).gte('1000000000000')) {
    throw new Error('Use a non-negative monthly budget with at most two decimal places.');
  }
  const budget = new Decimal(input.monthlyBudget);
  const maxMonths = input.maxMonths ?? 600;
  if (!Number.isInteger(maxMonths) || maxMonths < 1 || maxMonths > 1200) throw new Error('Invalid timeline limit.');
  const debts = input.debts.filter(debt => debt.effectiveBalance === null || new Decimal(debt.effectiveBalance).gt(0));
  const missingInputs: string[] = [];
  const warnings: string[] = [];
  for (const debt of debts) {
    if (debt.effectiveBalance === null) missingInputs.push(`${debt.name}: balance is unavailable`);
    if (debt.apr === null) missingInputs.push(`${debt.name}: standard APR is unknown`);
    if (debt.minimumPayment === null) missingInputs.push(`${debt.name}: minimum repayment is unknown`);
    if (debt.paymentRestrictions || debt.feeNotes) missingInputs.push(`${debt.name}: payment restrictions or fees need review before forecasting`);
    if (debt.sourceWarning) warnings.push(`${debt.name}: ${debt.sourceWarning}`);
    if (debt.balanceAsOf && debt.balanceAsOf !== input.asOf) warnings.push(`${debt.name}: balance dated ${debt.balanceAsOf}; intervening payments or interest may be missing`);
  }
  if (debts.some(debt => debt.priority)) warnings.push('Protect essential bills and priority debts first. Priority debts receive extra payments before other debts in both illustrations.');
  if (debts.some(debt => debt.inArrears)) warnings.push('Resolve arrears and agree affordable repayments with creditors before using an accelerated repayment plan. Free debt advice can help.');
  const startingBalance = debts.reduce((sum, debt) => sum.plus(debt.effectiveBalance ?? '0'), new Decimal(0));
  const methodology = [
    'Balances are a dated starting point. Linked ledger liabilities are read once; saved debt details do not add debt to net worth.',
    'Fixed monthly budget and fixed recorded minimums; no new borrowing, fees or changing lender minimum formulas.',
    'APR is approximated as simple daily interest on the opening monthly balance, using actual calendar days / 365; interest rounded to pennies before payment.',
    'Promotional interest ends at the start of its recorded expiry date. Payments occur monthly on the starting calendar day, capped in short months.',
    'Minimums are paid first, then extra payments follow the chosen strategy. Last payments never exceed the outstanding balance plus interest.',
    `Future rates and terms must be reviewed. Forecasts are illustrations, not payoff guarantees; capped at ${maxMonths} months.`,
  ];
  const base: DebtRepaymentResult = {
    strategy: input.strategy, status: 'incomplete', startingBalance: money(startingBalance), monthlyBudget: money(budget),
    totalInterest: null, totalPaid: null, months: null, payoffDate: null, requiredMinimum: null,
    missingInputs, warnings: [...new Set(warnings)], schedule: [], methodology,
  };
  if (missingInputs.length) return base;
  if (debts.some(debt => debt.inArrears)) return { ...base, status: 'attention_required' };
  if (debts.length === 0) return { ...base, status: 'paid_off', totalInterest: '0.00', totalPaid: '0.00', months: 0, payoffDate: input.asOf, requiredMinimum: '0.00' };
  const balances = new Map(debts.map(debt => [debt.id, new Decimal(debt.effectiveBalance!)]));
  let totalInterest = new Decimal(0);
  let totalPaid = new Decimal(0);
  let previousDate = input.asOf;
  let requiredMinimum = new Decimal(0);
  let finalYearOpeningBalances: Map<string, Decimal> | null = null;
  let hadInterestAbsorbedMonth = false;
  for (let month = 1; month <= maxMonths; month++) {
    if (maxMonths >= 12 && month === maxMonths - 11) finalYearOpeningBalances = new Map(balances);
    const date = monthlyPaymentDate(input.asOf, month);
    const active = debts.filter(debt => balances.get(debt.id)!.gt(0));
    const openingBalance = active.reduce((sum, debt) => sum.plus(balances.get(debt.id)!), new Decimal(0));
    const interests = new Map(active.map(debt => [debt.id, monthlyInterest(debt, balances.get(debt.id)!, previousDate, date)]));
    const due = new Map(active.map(debt => [debt.id, balances.get(debt.id)!.plus(interests.get(debt.id)!)]));
    const minimums = new Map(active.map(debt => [debt.id, Decimal.min(debt.minimumPayment!, due.get(debt.id)!)]));
    const monthMinimum = [...minimums.values()].reduce((sum, payment) => sum.plus(payment), new Decimal(0));
    if (month === 1) requiredMinimum = monthMinimum;
    if (monthMinimum.gt(budget)) return { ...base, status: 'insufficient_budget', requiredMinimum: money(monthMinimum) };
    const payments = new Map(minimums);
    let remaining = budget.minus(monthMinimum);
    const ranked = [...active].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority ? -1 : 1;
      const order = input.strategy === 'avalanche' ? rateOn(b, date).cmp(rateOn(a, date)) : due.get(a.id)!.cmp(due.get(b.id)!);
      return order || a.id.localeCompare(b.id);
    });
    for (const debt of ranked) {
      const extra = Decimal.min(remaining, due.get(debt.id)!.minus(payments.get(debt.id)!));
      payments.set(debt.id, payments.get(debt.id)!.plus(extra));
      remaining = remaining.minus(extra);
    }
    const interest = [...interests.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
    const payment = [...payments.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
    active.forEach(debt => balances.set(debt.id, due.get(debt.id)!.minus(payments.get(debt.id)!)));
    const closingBalance = [...balances.values()].reduce((sum, value) => sum.plus(value), new Decimal(0));
    totalInterest = totalInterest.plus(interest);
    totalPaid = totalPaid.plus(payment);
    base.schedule.push({
      month, date, openingBalance: money(openingBalance), interest: money(interest), payment: money(payment), closingBalance: money(closingBalance),
      payments: active.map(debt => ({ id: debt.id, name: debt.name, amount: money(payments.get(debt.id)!), interest: money(interests.get(debt.id)!), remaining: money(balances.get(debt.id)!) })),
    });
    if (payment.lte(interest)) hadInterestAbsorbedMonth = true;
    if (closingBalance.isZero()) return { ...base, status: 'paid_off', totalInterest: money(totalInterest), totalPaid: money(totalPaid), months: month, payoffDate: date, requiredMinimum: money(requiredMinimum), warnings: [...base.warnings, ...(hadInterestAbsorbedMonth ? ['Interest absorbs the payment budget in some months; balances can temporarily rise even in this eventual payoff illustration.'] : [])] };
    previousDate = date;
  }
  // A growing aggregate balance is not proof of permanent non-amortisation:
  // a targeted debt may still shrink and release its payment to other debts.
  // Simulate the whole horizon and describe only the final observed year.
  const noDebtDeclined = finalYearOpeningBalances !== null && [...finalYearOpeningBalances].every(([id, opening]) => balances.get(id)!.gte(opening));
  const laterRateReduction = debts.some(debt => debt.promotionalApr !== null && debt.promotionalExpiresOn !== null && debt.promotionalExpiresOn > previousDate && new Decimal(debt.apr!).lt(debt.promotionalApr));
  if (noDebtDeclined && !laterRateReduction) return { ...base, status: 'negative_amortization', requiredMinimum: money(requiredMinimum), warnings: [...base.warnings, `No debt balance fell in the final year of the ${maxMonths}-month illustration. No payoff was reached within this horizon; increase the budget or seek debt advice.`] };
  return { ...base, status: 'timeline_limit', requiredMinimum: money(requiredMinimum), warnings: [...base.warnings, 'Debt remains at the timeline limit; review the budget and interest assumptions.'] };
}

export function compareDebtRepayment(input: Omit<RepaymentInput, 'strategy'>) {
  return {
    avalanche: analyzeDebtRepayment({ ...input, strategy: 'avalanche' }),
    snowball: analyzeDebtRepayment({ ...input, strategy: 'snowball' }),
  };
}
