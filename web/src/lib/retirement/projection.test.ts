import { describe, expect, it } from 'vitest';
import Decimal from 'decimal.js';
import { projectRetirement, retirementInputSchema, type RetirementInput } from './projection';

const BASE: RetirementInput = {
  currentAge: 40, retirementAge: 50, currentPot: 100_000,
  monthlyContribution: 200, monthlyEmployerContribution: 100,
  annualGrowthRate: 0, annualFeeRate: 0, inflationRate: 0,
  desiredAnnualIncome: 20_000, expectedAnnualStatePension: 0,
  statePensionAge: 68, withdrawalRate: 4, sensitivitySpread: 2,
};
const baseScenario = (input: Partial<RetirementInput> = {}) => projectRetirement({ ...BASE, ...input }).scenarios[1];

describe('retirement projections', () => {
  it('credits gross personal deposits and employer deposits once with no implicit tax relief', () => {
    const result = baseScenario();
    expect(result.finalNominalPot).toBe('136000.00');
    expect(result.finalRealPot).toBe('136000.00');
    expect(result.personalContributions).toBe('24000.00');
    expect(result.employerContributions).toBe('12000.00');
    expect(result.feesPaid).toBe('0.00');
    expect(result.investmentGrowth).toBe('0.00');
    expect(result.points).toHaveLength(11);
    expect(result.points[1].nominalPot).toBe('103600.00');
  });

  it('compounds an effective annual return without rounding monthly balances', () => {
    const result = baseScenario({ retirementAge: 42, annualGrowthRate: 10, monthlyContribution: 0, monthlyEmployerContribution: 0 });
    expect(result.finalNominalPot).toBe('121000.00');
    expect(result.investmentGrowth).toBe('21000.00');
  });

  it('credits contributions at month-end rather than growing the final deposit', () => {
    const result = baseScenario({ currentPot: 0, retirementAge: 41, annualGrowthRate: 12, monthlyContribution: 100, monthlyEmployerContribution: 0 });
    const q = new Decimal(1.12).pow(new Decimal(1).div(12));
    const expected = new Decimal(100).mul(q.pow(12).minus(1).div(q.minus(1)));
    expect(result.finalNominalPot).toBe(expected.toFixed(2));
  });

  it('deducts effective annual fees and reports cumulative fees consistently', () => {
    const result = baseScenario({ retirementAge: 42, annualFeeRate: 1, monthlyContribution: 0, monthlyEmployerContribution: 0 });
    expect(result.finalNominalPot).toBe('98010.00');
    expect(result.feesPaid).toBe('1990.00');
    expect(result.investmentGrowth).toBe('0.00');
  });

  it('deflates nominal balances and inflates the target consistently', () => {
    const result = projectRetirement({ ...BASE, retirementAge: 42, inflationRate: 10, monthlyContribution: 0, monthlyEmployerContribution: 0 });
    expect(result.scenarios[1].finalRealPot).toBe('82644.63');
    expect(result.targetRealPot).toBe('500000.00');
    expect(result.targetNominalPot).toBe('605000.00');
  });

  it('solves an additional monthly contribution at zero net growth', () => {
    const result = baseScenario();
    expect(result.extraMonthlyContribution).toBe('3033.34');
    const funded = baseScenario({ monthlyContribution: BASE.monthlyContribution + Number(result.extraMonthlyContribution) });
    expect(Number(funded.realShortfall)).toBe(0);
  });

  it('solves additional contributions with both fees and growth', () => {
    const result = baseScenario({ annualGrowthRate: 5, annualFeeRate: 0.7, inflationRate: 2.5 });
    const funded = baseScenario({ annualGrowthRate: 5, annualFeeRate: 0.7, inflationRate: 2.5, monthlyContribution: BASE.monthlyContribution + Number(result.extraMonthlyContribution) });
    expect(Number(funded.realShortfall)).toBe(0);
  });

  it('handles offsetting growth and fees without an unstable annuity divisor', () => {
    const result = baseScenario({ annualGrowthRate: (1 / 0.9 - 1) * 100, annualFeeRate: 10 });
    expect(result.finalNominalPot).toBe('136000.00');
    expect(result.extraMonthlyContribution).toBe('3033.34');
    expect(Number(result.feesPaid)).toBeGreaterThan(0);
    expect(Number(result.investmentGrowth)).toBeGreaterThan(0);
  });

  it('keeps an empty pot empty across the maximum supported age horizon', () => {
    const result = projectRetirement({ ...BASE, currentAge: 18, retirementAge: 100, currentPot: 0, monthlyContribution: 0, monthlyEmployerContribution: 0 });
    expect(result.monthsToRetirement).toBe(984);
    for (const scenario of result.scenarios) {
      expect(scenario.points).toHaveLength(83);
      expect(scenario.points.at(-1)?.age).toBe(100);
      expect(scenario.finalNominalPot).toBe('0.00');
      expect(scenario.feesPaid).toBe('0.00');
    }
  });

  it('keeps balances unchanged when already at the chosen retirement age', () => {
    const result = baseScenario({ retirementAge: 40, annualGrowthRate: 25, annualFeeRate: 10, inflationRate: 20 });
    expect(result.finalNominalPot).toBe('100000.00');
    expect(result.personalContributions).toBe('0.00');
    expect(result.points).toHaveLength(1);
    expect(result.extraMonthlyContribution).toBeNull();
    expect(baseScenario({ retirementAge: 40, desiredAnnualIncome: 0 }).extraMonthlyContribution).toBe('0.00');
  });

  it('does not use later State Pension income to cover earlier retirement', () => {
    const result = projectRetirement({ ...BASE, expectedAnnualStatePension: 10_000 });
    expect(result.statePensionAtRetirement).toBe('0.00');
    expect(result.targetRealPot).toBe('500000.00');
    expect(result.yearsBeforeStatePension).toBe(18);
    expect(result.scenarios[1].totalIncomeAtRetirement).toBe('5440.00');
    expect(result.scenarios[1].totalIncomeAfterStatePension).toBe('15440.00');
  });

  it('uses State Pension only when the supplied age and forecast make it available', () => {
    const result = projectRetirement({ ...BASE, statePensionAge: 50, expectedAnnualStatePension: 10_000 });
    expect(result.statePensionAtRetirement).toBe('10000.00');
    expect(result.targetRealPot).toBe('250000.00');
    expect(result.scenarios[1].totalIncomeAtRetirement).toBe('15440.00');
  });

  it('floors a fully covered income target at zero', () => {
    expect(projectRetirement({ ...BASE, statePensionAge: 50, expectedAnnualStatePension: 30_000 }).targetRealPot).toBe('0.00');
  });

  it('keeps the cash reconciliation and sensitivity ordering', () => {
    const result = projectRetirement({ ...BASE, annualGrowthRate: 5, annualFeeRate: 0.8 });
    for (const scenario of result.scenarios) {
      const reconciled = new Decimal(BASE.currentPot).plus(scenario.personalContributions).plus(scenario.employerContributions).plus(scenario.investmentGrowth).minus(scenario.feesPaid);
      expect(reconciled.minus(scenario.finalNominalPot).abs().lte(0.01)).toBe(true);
    }
    expect(Number(result.scenarios[0].finalRealPot)).toBeLessThan(Number(result.scenarios[1].finalRealPot));
    expect(Number(result.scenarios[1].finalRealPot)).toBeLessThan(Number(result.scenarios[2].finalRealPot));
  });

  it('supports falling markets and clamps sensitivity to the supported range', () => {
    const result = projectRetirement({ ...BASE, annualGrowthRate: -40, sensitivitySpread: 10 });
    expect(result.scenarios[0].annualGrowthRate).toBe(-40);
    expect(result.scenarios[1].annualGrowthRate).toBe(-40);
    expect(Number(result.scenarios[1].investmentGrowth)).toBeLessThan(0);
  });

  it.each([
    { currentAge: 17 }, { retirementAge: 39 }, { currentAge: 40.5 },
    { currentPot: -1 }, { currentPot: Infinity }, { monthlyContribution: NaN },
    { monthlyEmployerContribution: -1 }, { annualGrowthRate: -100 },
    { annualFeeRate: 100 }, { withdrawalRate: 0 }, { inflationRate: -1 },
    { statePensionAge: 101 }, { expectedAnnualStatePension: -1 },
  ])('rejects unsupported or invalid input %j', override => {
    expect(retirementInputSchema.safeParse({ ...BASE, ...override }).success).toBe(false);
    expect(() => projectRetirement({ ...BASE, ...override })).toThrow();
  });

  it('rejects unknown fields rather than silently accepting unsupported assumptions', () => {
    expect(retirementInputSchema.safeParse({ ...BASE, taxReliefAlreadyAdded: false }).success).toBe(false);
  });
});
