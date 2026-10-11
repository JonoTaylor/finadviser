import Decimal from 'decimal.js';
import { ClientError } from '@/lib/errors';

/**
 * Parse a money input into a Decimal, rejecting anything that isn't a
 * finite, non-negative number. The tax engine never wants a negative
 * input (losses and refunds are modelled explicitly, not as negative
 * income), so a bad value is the caller's mistake and surfaces as a 400.
 */
export function nonNegativeMoney(value: Decimal.Value | null | undefined, label: string): Decimal {
  if (value === null || value === undefined || value === '') return new Decimal(0);
  let parsed: Decimal;
  try {
    parsed = new Decimal(value);
  } catch {
    throw new ClientError(`${label} must be a number`);
  }
  if (!parsed.isFinite()) throw new ClientError(`${label} must be a finite number`);
  if (parsed.isNeg()) throw new ClientError(`${label} cannot be negative`);
  return parsed;
}

/** Round to whole pence. Half-up; exact arithmetic is kept until the final step of each line. */
export function round2(value: Decimal): Decimal {
  return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}
