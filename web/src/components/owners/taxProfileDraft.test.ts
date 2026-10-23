import { describe, expect, it } from 'vitest';
import { buildTaxProfilePatch } from './taxProfileDraft';

describe('tax profile edits', () => {
  it('sends only edited values and preserves the original revision', () => {
    expect(buildTaxProfilePatch({ core: { payeTaxPaid: '24500' }, facts: {} }, 8)).toEqual({
      source: 'user', expectedRevision: 8, payeTaxPaid: '24500.00',
    });
  });

  it('keeps a confirmed zero distinct from clearing an unknown value', () => {
    const patch = buildTaxProfilePatch({ core: { savingsInterest: '0', payeTaxPaid: '' }, facts: { pensionAnnualAmount: '' } }, 2);
    expect(patch.savingsInterest).toBe('0.00');
    expect(patch.payeTaxPaid).toBeNull();
    expect(patch.facts?.pensionAnnualAmount).toBeNull();
    expect(patch).not.toHaveProperty('employmentIncome');
  });

  it('saves a percentage and an unknown tax method without creating a pension amount', () => {
    const patch = buildTaxProfilePatch({ core: {}, facts: { employeePensionPercent: '8', employerPensionPercent: '8', pensionMethod: 'unknown' } }, 0);
    expect(patch.facts).toEqual({ employeePensionPercent: 8, employerPensionPercent: 8, pensionMethod: 'unknown' });
    expect(patch.facts).not.toHaveProperty('pensionAnnualAmount');
  });

  it('preserves a confirmed bonus status and the choice of percentage instead of cash', () => {
    const patch = buildTaxProfilePatch({ core: {}, facts: { bonusPercent: '30', bonusAmount: '', bonusIsEstimate: 'false' } }, 3);
    expect(patch.facts).toEqual({ bonusPercent: 30, bonusAmount: null, bonusIsEstimate: false });
  });

  it('rejects invalid numeric or status inputs before any save request', () => {
    for (const facts of [{ bonusPercent: '130' }, { pensionAnnualAmount: '-50' }, { bonusIsEstimate: 'maybe' }]) {
      expect(() => buildTaxProfilePatch({ core: {}, facts }, 1)).toThrow();
    }
  });
});
