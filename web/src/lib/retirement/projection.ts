import Decimal from 'decimal.js';
import { z } from 'zod';

/** Rates are percentages. Contributions are gross, fixed nominal monthly amounts. */
export const retirementInputSchema = z.object({
  currentAge: z.number().int().min(18).max(100),
  retirementAge: z.number().int().min(18).max(100),
  currentPot: z.number().finite().min(0).max(100_000_000),
  monthlyContribution: z.number().finite().min(0).max(100_000),
  monthlyEmployerContribution: z.number().finite().min(0).max(100_000),
  annualGrowthRate: z.number().finite().min(-40).max(25),
  annualFeeRate: z.number().finite().min(0).max(10),
  inflationRate: z.number().finite().min(0).max(20),
  desiredAnnualIncome: z.number().finite().min(0).max(1_000_000),
  expectedAnnualStatePension: z.number().finite().min(0).max(100_000),
  statePensionAge: z.number().int().min(18).max(100),
  withdrawalRate: z.number().finite().min(1).max(10),
  sensitivitySpread: z.number().finite().min(0).max(10),
}).strict().refine(input => input.retirementAge >= input.currentAge, {
  path: ['retirementAge'],
  message: 'Retirement age must be at least your current age.',
});

export type RetirementInput = z.infer<typeof retirementInputSchema>;

export interface RetirementPoint {
  age: number;
  nominalPot: string;
  realPot: string;
  personalContributions: string;
  employerContributions: string;
  feesPaid: string;
}

export interface RetirementScenario {
  key: 'downside' | 'base' | 'upside';
  label: string;
  annualGrowthRate: number;
  points: RetirementPoint[];
  finalNominalPot: string;
  finalRealPot: string;
  privateAnnualIncome: string;
  totalIncomeAtRetirement: string;
  totalIncomeAfterStatePension: string;
  realShortfall: string;
  extraMonthlyContribution: string | null;
  personalContributions: string;
  employerContributions: string;
  feesPaid: string;
  investmentGrowth: string;
}

export interface RetirementProjection {
  yearsToRetirement: number;
  monthsToRetirement: number;
  yearsBeforeStatePension: number;
  statePensionAtRetirement: string;
  targetRealPot: string;
  targetNominalPot: string;
  scenarios: RetirementScenario[];
}

// A private Decimal constructor prevents unrelated calculators changing precision.
const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
const money = (amount: Decimal) => amount.toFixed(2);

/**
 * Deterministic illustration, not a probability model or drawdown simulation.
 * Each month: grow the existing pot, deduct its fee, then credit both deposits.
 * Annual fees are an effective percentage reduction; deposits do not grow or
 * incur fees until their next month. No tax relief is added automatically.
 */
export function projectRetirement(raw: RetirementInput): RetirementProjection {
  const input = retirementInputSchema.parse(raw);
  const years = input.retirementAge - input.currentAge;
  const months = years * 12;
  const withdrawal = new D(input.withdrawalRate).div(100);
  const inflationAtRetirement = new D(1).plus(new D(input.inflationRate).div(100)).pow(years);
  const stateAtRetirement = new D(input.retirementAge >= input.statePensionAge
    ? input.expectedAnnualStatePension : 0);
  const targetRealPot = D.max(0, new D(input.desiredAnnualIncome).minus(stateAtRetirement)).div(withdrawal);
  const targetNominalPot = targetRealPot.mul(inflationAtRetirement);
  const growthRates = [
    { key: 'downside' as const, label: 'Lower growth', rate: Math.max(-40, input.annualGrowthRate - input.sensitivitySpread) },
    { key: 'base' as const, label: 'Your assumption', rate: input.annualGrowthRate },
    { key: 'upside' as const, label: 'Higher growth', rate: Math.min(25, input.annualGrowthRate + input.sensitivitySpread) },
  ];
  const scenarios = growthRates.map(({ key, label, rate }): RetirementScenario => {
    const monthlyGrowth = new D(1).plus(new D(rate).div(100)).pow(new D(1).div(12));
    const monthlyFeeRetention = new D(1).minus(new D(input.annualFeeRate).div(100)).pow(new D(1).div(12));
    const netMonthlyFactor = monthlyGrowth.mul(monthlyFeeRetention);
    const monthlyInflation = new D(1).plus(new D(input.inflationRate).div(100)).pow(new D(1).div(12));
    const personalDeposit = new D(input.monthlyContribution);
    const employerDeposit = new D(input.monthlyEmployerContribution);
    const totalDeposit = personalDeposit.plus(employerDeposit);
    let pot = new D(input.currentPot);
    let fees = new D(0);
    let growth = new D(0);
    let inflation = new D(1);
    // Future value of £1 credited at each month-end; recurrence also handles
    // zero net growth without a division-by-zero annuity formula.
    let depositFutureValue = new D(0);
    const points: RetirementPoint[] = [{
      age: input.currentAge, nominalPot: money(pot), realPot: money(pot),
      personalContributions: '0.00', employerContributions: '0.00', feesPaid: '0.00',
    }];
    for (let month = 1; month <= months; month += 1) {
      const grownPot = pot.mul(monthlyGrowth);
      growth = growth.plus(grownPot.minus(pot));
      const fee = grownPot.mul(new D(1).minus(monthlyFeeRetention));
      fees = fees.plus(fee);
      pot = grownPot.minus(fee).plus(totalDeposit);
      inflation = inflation.mul(monthlyInflation);
      depositFutureValue = depositFutureValue.mul(netMonthlyFactor).plus(1);
      if (month % 12 === 0) {
        points.push({
          age: input.currentAge + month / 12,
          nominalPot: money(pot), realPot: money(pot.div(inflation)),
          personalContributions: money(personalDeposit.mul(month)),
          employerContributions: money(employerDeposit.mul(month)), feesPaid: money(fees),
        });
      }
    }
    const realPot = pot.div(inflationAtRetirement);
    const privateIncome = realPot.mul(withdrawal);
    const nominalShortfall = D.max(0, targetNominalPot.minus(pot));
    return {
      key, label, annualGrowthRate: rate, points,
      finalNominalPot: money(pot), finalRealPot: money(realPot),
      privateAnnualIncome: money(privateIncome),
      totalIncomeAtRetirement: money(privateIncome.plus(stateAtRetirement)),
      totalIncomeAfterStatePension: money(privateIncome.plus(input.expectedAnnualStatePension)),
      realShortfall: money(D.max(0, targetRealPot.minus(realPot))),
      extraMonthlyContribution: months === 0 && nominalShortfall.gt(0)
        ? null
        : months === 0 ? '0.00' : nominalShortfall.div(depositFutureValue).toFixed(2, Decimal.ROUND_UP),
      personalContributions: money(personalDeposit.mul(months)),
      employerContributions: money(employerDeposit.mul(months)),
      feesPaid: money(fees), investmentGrowth: money(growth),
    };
  });
  return {
    yearsToRetirement: years, monthsToRetirement: months,
    yearsBeforeStatePension: Math.max(0, input.statePensionAge - input.retirementAge),
    statePensionAtRetirement: money(stateAtRetirement),
    targetRealPot: money(targetRealPot), targetNominalPot: money(targetNominalPot), scenarios,
  };
}
