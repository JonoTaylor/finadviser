import Decimal from 'decimal.js';
import { z } from 'zod';

const balance = z.string().trim().min(1).superRefine((value, context) => {
  if (!/^-?\d+(\.\d{1,2})?$/.test(value)) {
    context.addIssue({ code: 'custom', message: 'must be a decimal string with at most 2 decimal places' });
  } else if (new Decimal(value).abs().gte('1000000000000')) {
    context.addIssue({ code: 'custom', message: 'is too large' });
  }
}).transform(value => new Decimal(value).toFixed(2));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD').refine(value => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number(value.slice(0, 4)) > 0 && !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'must be a valid calendar date');
const description = z.string().trim().max(500).optional();

export const investmentBalanceBodySchema = z.object({
  newBalance: balance,
  asOfDate: date.optional(),
  description,
}).strict();

export const investmentBalanceInputSchema = z.object({
  accountId: z.number().int().min(1).max(2147483647),
  newBalance: balance,
  asOfDate: date,
  description,
}).strict();
