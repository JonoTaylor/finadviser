import { describe, expect, it } from 'vitest';
import { emptyTaxProfileFacts, ownerTaxProfilePatchSchema, resolveTaxProfileInputs, taxMoneySchema } from './profileFacts';

describe('partial tax profile facts validation', () => {
  it('requires a revision and at least one supplied fact', () => {
    for (const input of [{}, { expectedRevision: 0 }, { expectedRevision: 0, facts: {} },
      { expectedRevision: -1, payeTaxPaid: 0 }, { expectedRevision: 0.5, payeTaxPaid: 0 }]) {
      expect(ownerTaxProfilePatchSchema.safeParse(input).success).toBe(false);
    }
  });
  it('keeps omission, null and explicit zero distinct', () => {
    const input = ownerTaxProfilePatchSchema.parse({ expectedRevision: 0, payeTaxPaid: 0, employmentIncome: null });
    expect(input).toEqual({ expectedRevision: 0, source: 'user', payeTaxPaid: '0.00', employmentIncome: null });
    expect(input.otherIncome).toBeUndefined();
  });
  it('accepts percentage strings but rejects invalid or ambiguous financial inputs', () => {
    expect(ownerTaxProfilePatchSchema.parse({ expectedRevision: 0, facts: { employeePensionPercent: '8.125' } }).facts?.employeePensionPercent).toBe(8.125);
    for (const facts of [{ employeePensionPercent: 101 }, { employerPensionPercent: -8 },
      { pensionMethod: 'automatic' }, { baseSalary: '95,000' },
      { bonusAmount: 28500, bonusPercent: 30 }, { jurisdiction: 'uk' }]) {
      expect(ownerTaxProfilePatchSchema.safeParse({ expectedRevision: 0, facts }).success).toBe(false);
    }
    expect(ownerTaxProfilePatchSchema.safeParse({ expectedRevision: 0, salary: 95000 }).success).toBe(false);
  });
  it('rejects malformed money without throwing a Decimal parsing exception', () => {
    for (const amount of ['abc', '-1', '1.234', '1,000', 'Infinity', Number.NaN, Infinity, '1000000000000']) {
      expect(taxMoneySchema.safeParse(amount).success).toBe(false);
    }
  });
});

describe('saved year-specific tax assumptions', () => {
  const profile = { employmentIncome: '0.00', knownFields: [], facts: { ...emptyTaxProfileFacts } };
  it('does not infer total employment income from base salary alone or an unclassified bonus', () => {
    expect(resolveTaxProfileInputs({ ...profile, facts: { ...profile.facts, baseSalary: '95000.00' } }).employmentKnown).toBe(false);
    expect(resolveTaxProfileInputs({ ...profile, facts: { ...profile.facts, baseSalary: '95000.00', bonusPercent: 30 } }).employmentKnown).toBe(false);
  });
  it('derives an explicit year scenario without turning an estimated bonus into actual pay', () => {
    expect(resolveTaxProfileInputs({ ...profile, facts: { ...profile.facts, baseSalary: '95000.00', bonusPercent: 30, bonusIsEstimate: true } }))
      .toMatchObject({ employmentIncome: '123500.00', employmentKnown: true, estimated: true });
  });
  it('does not infer relief-at-source gross contributions from an ambiguous percentage', () => {
    expect(resolveTaxProfileInputs({ ...profile, facts: { ...profile.facts, baseSalary: '95000.00', employeePensionPercent: 8,
      employerPensionPercent: 8, pensionBasis: 'base_salary', pensionMethod: 'relief_at_source', employmentIncomeBasis: 'gross_before_pension' } }).pensionAnnualAmount).toBeUndefined();
  });
});
