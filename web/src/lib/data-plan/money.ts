import Decimal from 'decimal.js';

/** '1234.5' -> '£1,234.50'; negatives keep the sign in front of the symbol. */
export function formatGbp(value: Decimal.Value): string {
  const d = new Decimal(value);
  const fixed = d.abs().toFixed(2);
  const [whole, pence] = fixed.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${d.isNegative() && !d.isZero() ? '-' : ''}£${grouped}.${pence}`;
}

/** Signed difference with an explicit '+' for positives, e.g. '+£22,000.00'. */
export function formatGbpDelta(before: Decimal.Value, after: Decimal.Value): string {
  const diff = new Decimal(after).minus(before);
  if (diff.isZero()) return '£0.00';
  return `${diff.isPositive() ? '+' : ''}${formatGbp(diff)}`;
}

export function decimalEquals(a: string | null | undefined, b: string | null | undefined): boolean {
  if (a == null || b == null) return a == null && b == null;
  try {
    return new Decimal(a).eq(new Decimal(b));
  } catch {
    return false;
  }
}
