import { describe, expect, it } from 'vitest';
import { computeOwnerTax } from './ownerTaxComputation';
import {
  emptyTaxProfileFacts,
  resolveTaxProfileInputs,
  type TaxMoneyField,
  type TaxProfileFacts,
} from './profileFacts';

// Synthetic owner-share ledger figures, not a claim about any live property.
const properties = [{
  name: 'Illustrative rental', lettingType: 'standard' as const,
  grossIncome: '13200.00', totalExpenses: '776.51', mortgageInterest: '8375.20',
}];
const salaryFacts: Partial<TaxProfileFacts> = {
  baseSalary: '95000.00', bonusPercent: 30, bonusIsEstimate: true,
  employeePensionPercent: 8, employerPensionPercent: 8,
};

function resolve(facts: Partial<TaxProfileFacts>, employmentIncome = '0.00', knownFields: TaxMoneyField[] = []) {
  return resolveTaxProfileInputs({ employmentIncome, knownFields, facts: { ...emptyTaxProfileFacts, ...facts } });
}

function compute(resolved: ReturnType<typeof resolveTaxProfileInputs>) {
  return computeOwnerTax({
    taxYear: '2025-26', properties,
    profile: {
      employmentIncome: resolved.employmentIncome,
      payeTaxPaid: 0, selfEmploymentIncome: 0, savingsInterest: 0, dividends: 0,
      otherIncome: 0, propertyLossesBroughtForward: 0, financeCostsBroughtForward: 0,
      pensionAnnualAmount: resolved.pensionAnnualAmount,
      pensionMethod: resolved.pensionMethod,
      employmentIncomeBasis: resolved.employmentIncomeBasis,
    },
  });
}

describe('saved tax facts consumed by the deterministic tax engine', () => {
  it('uses the explicitly estimated bonus without inventing a pension method or treating employer matching as a deduction', () => {
    const resolved = resolve(salaryFacts);
    expect(resolved.employmentIncome).toBe('123500.00');
    expect(resolved.estimated).toBe(true);
    expect(resolved.pensionAnnualAmount).toBeUndefined();
    const result = compute(resolved);
    expect(result.pension?.applied).toBe(false);
    expect(result.income.nonSavings).toBe('123500.00');
    expect(result.taxOnRentalIncome).toMatchObject({
      liabilityWithoutProperty: '41532.00', liabilityWithProperty: '45693.53', amount: '4161.53',
    });
  });

  it('does not infer salary-only employment income when the tax-year bonus remains unknown', () => {
    const resolved = resolve({ baseSalary: '95000.00' });
    expect(resolved.employmentKnown).toBe(false);
    expect(resolved.employmentIncome).toBe('0.00');
    expect(resolved.warnings.join(' ')).toContain('bonus amount/status');
  });

  it('keeps a salary-rate projection estimated even when the bonus itself is confirmed', () => {
    const resolved = resolve({ ...salaryFacts, bonusIsEstimate: false });
    expect(resolved.employmentIncome).toBe('123500.00');
    expect(resolved.employmentKnown).toBe(true);
    expect(resolved.estimated).toBe(true);
  });

  it('treats a salary-rate projection as gross pay rather than carrying over a stale P60 pay basis', () => {
    const resolved = resolve({
      ...salaryFacts, pensionAnnualAmount: '7600.00', pensionMethod: 'net_pay',
      employmentIncomeBasis: 'taxable_pay_after_pension',
    });
    expect(resolved.employmentIncomeBasis).toBe('gross_before_pension');
    expect(resolved.estimated).toBe(true);
    const result = compute(resolved);
    expect(result.pension?.employmentDeduction).toBe('7600.00');
    expect(result.income.nonSavings).toBe('115900.00');
  });

  it('keeps a partial pension fact usable while employment income is still unknown', () => {
    const resolved = resolve({
      pensionAnnualAmount: '7600.00', pensionMethod: 'net_pay',
      employmentIncomeBasis: 'gross_before_pension',
    });
    expect(resolved.employmentKnown).toBe(false);
    expect(() => compute(resolved)).not.toThrow();
    expect(compute(resolved).pension?.applied).toBe(false);
  });

  it('honours explicitly entered annual taxable pay over current salary and bonus facts and avoids a second pension deduction', () => {
    const resolved = resolve({
      ...salaryFacts, pensionMethod: 'net_pay', pensionBasis: 'base_salary',
      pensionAnnualAmount: '7600.00', employmentIncomeBasis: 'taxable_pay_after_pension',
    }, '115900.00', ['employmentIncome']);
    expect(resolved.employmentIncome).toBe('115900.00');
    const result = compute(resolved);
    expect(result.income.nonSavings).toBe('115900.00');
    expect(result.pension?.employmentDeduction).toBe('0.00');
    expect(result.taxOnRentalIncome.amount).toBe('5301.53');
  });

  it('keeps a confirmed zero annual employment income distinct from an unconfirmed salary fact', () => {
    const resolved = resolve(salaryFacts, '0.00', ['employmentIncome']);
    expect(resolved.employmentKnown).toBe(true);
    expect(resolved.employmentIncome).toBe('0.00');
    expect(resolved.estimated).toBe(false);
  });

  it('marks a percentage-derived employee contribution as an illustration and applies net pay exactly once', () => {
    const resolved = resolve({
      ...salaryFacts, pensionMethod: 'net_pay', pensionBasis: 'base_salary',
      employmentIncomeBasis: 'gross_before_pension', jurisdiction: 'england_wales_ni',
    });
    expect(resolved.pensionAnnualAmount).toBe('7600.00');
    expect(resolved.estimated).toBe(true);
    expect(resolved.warnings.join(' ')).toContain('annual illustration');
    const result = compute(resolved);
    expect(result.pension?.employmentDeduction).toBe('7600.00');
    expect(result.income.nonSavings).toBe('115900.00');
    expect(result.taxOnRentalIncome.amount).toBe('5301.53');
    expect(result.incomeTax.liability).toBe('42273.53');
  });

  it('treats relief at source as an ANI and band adjustment rather than subtracting it from actual income', () => {
    const resolved = resolve({
      ...salaryFacts, pensionAnnualAmount: '7600.00', pensionMethod: 'relief_at_source',
      employmentIncomeBasis: 'taxable_pay_after_pension', jurisdiction: 'england_wales_ni',
    });
    const result = compute(resolved);
    expect(result.income.total).toBe('135923.49');
    expect(result.income.adjustedNetIncome).toBe('128323.49');
    expect(result.pension?.employmentDeduction).toBe('0.00');
    expect(result.taxOnRentalIncome.amount).toBe('5301.53');
    expect(result.incomeTax.liability).toBe('43793.53');
  });

  it('does not apply a known pension amount without its tax method', () => {
    const resolved = resolve({ ...salaryFacts, pensionAnnualAmount: '7600.00' });
    const result = compute(resolved);
    expect(result.pension?.annualEmployeeAmount).toBe('7600.00');
    expect(result.pension?.applied).toBe(false);
    expect(result.taxOnRentalIncome.amount).toBe('4161.53');
    expect(result.warnings.join(' ')).toContain('confirm salary sacrifice, net pay or relief at source');
  });

  it('does not mistake an ambiguous relief-at-source percentage for a confirmed gross contribution', () => {
    const resolved = resolve({
      ...salaryFacts, pensionMethod: 'relief_at_source', pensionBasis: 'base_salary',
      employmentIncomeBasis: 'gross_before_pension',
    });
    expect(resolved.pensionAnnualAmount).toBeUndefined();
    const result = compute(resolved);
    expect(result.pension?.applied).toBe(false);
    expect(result.taxOnRentalIncome.amount).toBe('4161.53');
  });

  it('never silently treats unknown or Scottish tax residence as confirmed rUK residence', () => {
    expect(resolve(salaryFacts).warnings.join(' ')).toContain('Tax residence is unconfirmed');
    expect(resolve({ ...salaryFacts, jurisdiction: 'scotland' }).warnings.join(' '))
      .toContain('Scottish income tax is not supported');
  });
});
