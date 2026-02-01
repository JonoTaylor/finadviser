import Decimal from 'decimal.js';

export function formatCurrency(amount: string | number | Decimal, symbol = '£'): string {
  const value = new Decimal(amount.toString());
  const abs = value.abs().toFixed(2);
  const formatted = abs.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return value.isNeg() ? `-${symbol}${formatted}` : `${symbol}${formatted}`;
}

export function formatPercentage(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`;
}
