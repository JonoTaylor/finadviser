import { z } from 'zod';
import Decimal from 'decimal.js';

/**
 * Request validation for the owner tax profile and the property letting
 * type. Money arrives as a number or a numeric string, must be
 * non-negative with at most 2 decimal places, and is normalised to a
 * 2dp string so the repo can hand it straight to NUMERIC(14,2).
 */

// NUMERIC(14,2) holds up to 999,999,999,999.99.
const MAX_MONEY = new Decimal('1000000000000');

const money = z
  .union([z.number(), z.string().trim().min(1)])
  .transform(v => String(v))
  // One refinement, not two: zod still runs a later refine after an earlier
  // one fails, and new Decimal('abc') would throw instead of giving a 400.
  .superRefine((v, ctx) => {
    if (!/^\d+(\.\d{1,2})?$/.test(v)) {
      ctx.addIssue({ code: 'custom', message: 'must be a non-negative amount with at most 2 decimal places' });
      return;
    }
    if (new Decimal(v).gte(MAX_MONEY)) {
      ctx.addIssue({ code: 'custom', message: 'is too large' });
    }
  })
  .transform(v => new Decimal(v).toFixed(2));

export const ownerTaxProfileBodySchema = z
  .object({
    employmentIncome: money.optional(),
    payeTaxPaid: money.optional(),
    selfEmploymentIncome: money.optional(),
    savingsInterest: money.optional(),
    dividends: money.optional(),
    otherIncome: money.optional(),
    propertyLossesBroughtForward: money.optional(),
    financeCostsBroughtForward: money.optional(),
    notes: z
      .string()
      .max(2000)
      .nullable()
      .optional()
      .transform(v => (v && v.trim() !== '' ? v.trim() : null)),
  })
  .strict();

export type OwnerTaxProfileBody = z.infer<typeof ownerTaxProfileBodySchema>;

export const LETTING_TYPES = ['standard', 'rent_a_room'] as const;

export const propertyPatchBodySchema = z
  .object({
    lettingType: z.enum(LETTING_TYPES),
  })
  .strict();

/** "path: message; path: message" for a 400 body. */
export function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map(i => (i.path.length > 0 ? `${i.path.join('.')} ${i.message}` : i.message))
    .join('; ');
}
