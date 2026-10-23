import Decimal from 'decimal.js';
import { z } from 'zod';

export const taxMoneyFields = [
  'employmentIncome', 'payeTaxPaid', 'selfEmploymentIncome', 'savingsInterest',
  'dividends', 'otherIncome', 'propertyLossesBroughtForward', 'financeCostsBroughtForward',
] as const;
export type TaxMoneyField = typeof taxMoneyFields[number];
export const knownTaxFieldsSchema = z.array(z.enum(taxMoneyFields)).max(taxMoneyFields.length);
export const taxMoneyFieldLabels: Record<TaxMoneyField, string> = {
  employmentIncome: 'Employment income', payeTaxPaid: 'PAYE tax paid',
  selfEmploymentIncome: 'Self-employment income', savingsInterest: 'Savings interest',
  dividends: 'Dividends', otherIncome: 'Other income',
  propertyLossesBroughtForward: 'Property losses brought forward',
  financeCostsBroughtForward: 'Finance costs brought forward',
};

export const taxMoneySchema = z.union([z.number().finite(), z.string().trim().min(1)])
  .transform(String)
  .superRefine((value, ctx) => {
    if (!/^\d+(\.\d{1,2})?$/.test(value) || new Decimal(value).gte('1000000000000')) {
      ctx.addIssue({ code: 'custom', message: 'must be a non-negative amount below 1 trillion with at most 2 decimal places' });
    }
  }).transform(value => new Decimal(value).toFixed(2));

const percentage = z.union([z.number().finite(), z.string().trim().regex(/^\d+(\.\d{1,4})?$/)])
  .transform(Number).pipe(z.number().finite().min(0).max(100));
export const taxProfileFactsSchema = z.object({
  baseSalary: taxMoneySchema.nullable(),
  bonusPercent: percentage.nullable(),
  bonusAmount: taxMoneySchema.nullable(),
  bonusIsEstimate: z.boolean().nullable(),
  employeePensionPercent: percentage.nullable(),
  employerPensionPercent: percentage.nullable(),
  pensionBasis: z.enum(['base_salary', 'total_pay', 'qualifying_earnings', 'unknown']),
  pensionMethod: z.enum(['salary_sacrifice', 'net_pay', 'relief_at_source', 'unknown']),
  /** Gross annual employee contribution, excluding employer contributions. */
  pensionAnnualAmount: taxMoneySchema.nullable(),
  employmentIncomeBasis: z.enum(['gross_before_pension', 'taxable_pay_after_pension', 'unknown']),
  jurisdiction: z.enum(['england_wales_ni', 'scotland', 'unknown']),
}).strict();
export type TaxProfileFacts = z.infer<typeof taxProfileFactsSchema>;

export const emptyTaxProfileFacts: TaxProfileFacts = {
  baseSalary: null, bonusPercent: null, bonusAmount: null, bonusIsEstimate: null,
  employeePensionPercent: null, employerPensionPercent: null,
  pensionBasis: 'unknown', pensionMethod: 'unknown', pensionAnnualAmount: null,
  employmentIncomeBasis: 'unknown', jurisdiction: 'unknown',
};

export const taxFieldSourceSchema = z.object({
  source: z.enum(['user', 'ai', 'legacy']), updatedAt: z.iso.datetime(),
}).strict();
export type TaxFieldSource = z.infer<typeof taxFieldSourceSchema>;
export const taxFieldSourcesSchema = z.record(z.string(), taxFieldSourceSchema);

export const ownerTaxProfilePatchSchema = z.object({
  expectedRevision: z.number().int().min(0).max(999_999_999),
  source: z.enum(['user', 'ai']).default('user'),
  employmentIncome: taxMoneySchema.nullable().optional(),
  payeTaxPaid: taxMoneySchema.nullable().optional(),
  selfEmploymentIncome: taxMoneySchema.nullable().optional(),
  savingsInterest: taxMoneySchema.nullable().optional(),
  dividends: taxMoneySchema.nullable().optional(),
  otherIncome: taxMoneySchema.nullable().optional(),
  propertyLossesBroughtForward: taxMoneySchema.nullable().optional(),
  financeCostsBroughtForward: taxMoneySchema.nullable().optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  facts: taxProfileFactsSchema.partial().optional(),
}).strict().superRefine((input, ctx) => {
  if (!taxMoneyFields.some(key => input[key] !== undefined)
    && input.notes === undefined && Object.keys(input.facts ?? {}).length === 0) {
    ctx.addIssue({ code: 'custom', message: 'Supply at least one tax profile fact to save' });
  }
  if (input.facts?.bonusAmount != null && input.facts?.bonusPercent != null) {
    ctx.addIssue({ code: 'custom', path: ['facts'], message: 'Supply either a bonus amount or percentage, not both' });
  }
});
export type OwnerTaxProfilePatch = z.infer<typeof ownerTaxProfilePatchSchema>;

export class TaxProfileConflictError extends Error {
  readonly status = 409;
  constructor() {
    super('This tax profile changed since it was loaded. Reload it before saving; no changes have been written.');
    this.name = 'TaxProfileConflictError';
  }
}

/** Resolves only year-specific saved facts; current conversation memory is never a tax-year input. */
export function resolveTaxProfileInputs(profile: {
  employmentIncome: string; knownFields: TaxMoneyField[]; facts: TaxProfileFacts;
}) {
  const { facts } = profile;
  const warnings: string[] = [];
  let employmentIncome = profile.employmentIncome;
  let employmentKnown = profile.knownFields.includes('employmentIncome');
  let estimated = false;
  let employmentIncomeBasis = facts.employmentIncomeBasis;
  if (!employmentKnown && facts.baseSalary !== null) {
    const bonus = facts.bonusAmount !== null ? new Decimal(facts.bonusAmount)
      : facts.bonusPercent !== null ? new Decimal(facts.baseSalary).mul(facts.bonusPercent).div(100) : null;
    if (bonus !== null && facts.bonusIsEstimate !== null) {
      employmentIncome = new Decimal(facts.baseSalary).plus(bonus).toFixed(2);
      employmentKnown = true;
      // A contractual salary rate is not evidence of a whole year's actual
      // earnings (pay rises, leave and job changes can all affect them).
      estimated = true;
      employmentIncomeBasis = 'gross_before_pension';
      warnings.push(`Employment income is a whole-year gross salary projection plus ${facts.bonusIsEstimate ? 'estimated' : 'confirmed'} bonus for this tax year; confirm actual annual pay and bonus timing before filing. Pension deductions have not yet been removed from this projection.`);
    } else {
      warnings.push('Base salary is saved, but the bonus amount/status for this tax year is unknown. Employment income has not been inferred from salary alone.');
    }
  }
  let pensionAnnualAmount = facts.pensionAnnualAmount ?? undefined;
  if (pensionAnnualAmount === undefined && facts.employeePensionPercent !== null
    && ['salary_sacrifice', 'net_pay'].includes(facts.pensionMethod)
    && employmentIncomeBasis === 'gross_before_pension') {
    const basis = facts.pensionBasis === 'base_salary' ? facts.baseSalary
      : facts.pensionBasis === 'total_pay' && employmentKnown ? employmentIncome : null;
    if (basis !== null) {
      pensionAnnualAmount = new Decimal(basis).mul(facts.employeePensionPercent).div(100).toFixed(2);
      estimated = true;
      warnings.push('Employee pension amount is an annual illustration from the saved percentage and salary basis. Confirm the gross annual amount from pension/payroll records.');
    }
  }
  if (facts.employeePensionPercent !== null && pensionAnnualAmount === undefined) {
    warnings.push('Pension percentage is saved, but no pension deduction is assumed without the contribution basis, tax method and gross annual amount. Employer matching is not deducted from your income.');
  }
  if (!employmentKnown && employmentIncomeBasis === 'gross_before_pension'
    && ['salary_sacrifice', 'net_pay'].includes(facts.pensionMethod) && pensionAnnualAmount !== undefined) {
    pensionAnnualAmount = undefined;
    warnings.push('The pension contribution is saved, but no deduction is applied while annual employment income is unknown. Save the pay figure to include it in this scenario.');
  }
  if (facts.jurisdiction !== 'england_wales_ni') {
    warnings.push(facts.jurisdiction === 'scotland'
      ? 'Scottish income tax is not supported by this computation. Figures use England/Wales/Northern Ireland rules and must not be treated as your tax bill.'
      : 'Tax residence is unconfirmed. Figures illustrate England/Wales/Northern Ireland rules only.');
  }
  return {
    employmentIncome, employmentKnown, estimated, pensionAnnualAmount,
    pensionMethod: facts.pensionMethod, employmentIncomeBasis,
    warnings,
  };
}
