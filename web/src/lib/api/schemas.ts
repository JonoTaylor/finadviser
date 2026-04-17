import { z } from 'zod';

// Shared primitives used across /api/* Zod schemas.

// Positive integer parsed from a string (for path params + query strings).
export const idString = z
  .string()
  .regex(/^\d+$/, 'Must be a positive integer')
  .transform((v) => parseInt(v, 10))
  .refine((n) => n > 0 && n <= Number.MAX_SAFE_INTEGER, 'Out of range');

// Positive integer in JSON body.
export const idNumber = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// Pagination (query). `limit` is capped to protect the DB.
export const pagination = z.object({
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n > 0 && n <= 500, 'limit must be 1..500')
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n >= 0 && n <= 1_000_000, 'offset must be 0..1,000,000')
    .optional(),
});

// YYYY-MM-DD date string.
export const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be in YYYY-MM-DD format');

// YYYY-MM month string.
export const monthString = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format');

// Monetary amount as a string (Decimal-safe). Accepts optional sign + up to
// 2 fractional digits. Reject scientific notation and whitespace.
export const moneyString = z
  .string()
  .regex(/^-?\d+(\.\d{1,2})?$/, 'Amount must be a decimal with up to 2 fractional digits');

// Path-param schema for routes like /api/things/[id].
export const idParams = z.object({ id: idString });

// Optional query integer (string -> number).
export const optionalIntQuery = z
  .string()
  .regex(/^\d+$/)
  .transform((v) => parseInt(v, 10))
  .refine((n) => n >= 0 && n <= Number.MAX_SAFE_INTEGER)
  .optional();

export const accountType = z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']);
export const matchType = z.enum(['contains', 'startswith', 'exact', 'regex']);
export const ruleSource = z.enum(['user', 'ai', 'system']);
