import Decimal from 'decimal.js';
import { z } from 'zod';

const money = z.union([z.number().finite(), z.string().trim().min(1)])
  .transform(value => String(value))
  .superRefine((value, context) => {
    if (!/^\d+(\.\d{1,2})?$/.test(value)) {
      context.addIssue({ code: 'custom', message: 'must be a non-negative amount with at most 2 decimal places' });
    } else if (new Decimal(value).gte('1000000000000')) {
      context.addIssue({ code: 'custom', message: 'is too large' });
    }
  })
  .transform(value => new Decimal(value).toFixed(2));

const positiveMoney = money.refine(value => new Decimal(value).gt(0), 'must be greater than zero');
const id = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD')
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, 'must be a valid calendar date');
const name = z.string().trim().min(1).max(160);

export const budgetBodySchema = z.object({
  categoryId: id,
  monthlyLimit: money,
  effectiveFrom: date,
}).strict();

export const savingsGoalBodySchema = z.object({
  name,
  targetAmount: positiveMoney,
  currentAmount: money.optional(),
  targetDate: date.nullable().optional(),
  accountId: id.nullable().optional(),
}).strict();

export const savingsGoalPatchSchema = z.object({
  id,
  name: name.optional(),
  targetAmount: positiveMoney.optional(),
  currentAmount: money.optional(),
  targetDate: date.nullable().optional(),
  accountId: id.nullable().optional(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
}).strict().refine(value => Object.keys(value).length > 1, 'provide at least one field to update');

export function financialPlanValidationError(error: z.ZodError): string {
  return error.issues.map(issue => `${issue.path.join('.') || 'body'} ${issue.message}`).join('; ');
}
