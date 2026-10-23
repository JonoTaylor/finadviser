import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { parseMortgagePayments } from './mortgage-payment-parser';

const reportedRows = [
  ['30/09/2026', '1861.22', '2026-09-30'],
  ['28/08/2026', '1861.22', '2026-08-28'],
  ['31/07/2026', '1382.36', '2026-07-31'],
  ['30/06/2026', '1382.36', '2026-06-30'],
  ['29/05/2026', '1382.36', '2026-05-29'],
  ['30/04/2026', '1382.36', '2026-04-30'],
  ['31/03/2026', '1382.36', '2026-03-31'],
  ['27/02/2026', '1382.36', '2026-02-27'],
  ['30/01/2026', '1382.36', '2026-01-30'],
];

describe('mortgage statement payment dates', () => {
  it.each(['\n', ' ', ''])('retains all nine exact reported dates with separator %j', separator => {
    const text = reportedRows.map(([date, amount]) => `${date} Receipt £${amount} Credit`).join(separator);
    const parsed = parseMortgagePayments(text);
    expect(parsed.valid.map(({ date, amount }) => [date, amount])).toEqual(reportedRows.map(([, amount, date]) => [date, amount]));
    expect(parsed.unparsed).toEqual([]);
    expect(parsed.issues).toEqual([]);
    expect(parsed.skipped).toEqual([]);
  });

  it('parses each of the four missing payments independently, without inventing a date or rounding the total', () => {
    const missing = reportedRows.filter(([, , date]) => date.endsWith('-30'));
    const payments = missing.flatMap(([date, amount]) => parseMortgagePayments(`${date} Receipt £${amount} Credit`).valid);
    expect(payments.map(payment => payment.date)).toEqual(['2026-09-30', '2026-06-30', '2026-04-30', '2026-01-30']);
    expect(payments.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0)).toFixed(2)).toBe('6008.30');
  });

  it('retains every valid calendar date in common and leap years across repeat calls', () => {
    for (const year of [2024, 2025, 2026]) {
      const dates: string[] = [];
      const rows: string[] = [];
      for (let month = 1; month <= 12; month += 1) {
        const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
        for (let day = 1; day <= days; day += 1) {
          dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
          rows.push(`${day}/${month}/${year} Receipt £1,382.36 Credit`);
        }
      }
      const parsed = parseMortgagePayments(rows.join(''));
      expect(parsed.valid.map(payment => payment.date)).toEqual(dates);
      expect(parsed.unparsed).toEqual([]);
    }
  });

  it.each(['31/02/2026', '29/02/2025', '31/04/2026', '00/01/2026', '30/00/2026',
    '128/08/2026', '28/008/2026', '28/08/20260', '28/08/2026/1'])('rejects the complete invalid date %s without salvaging a suffix', date => {
    const parsed = parseMortgagePayments(`${date} Receipt £1,382.36 Credit30/09/2026 Receipt £1,861.22 Credit`);
    expect(parsed.valid.map(payment => payment.date)).toEqual(['2026-09-30']);
    expect(parsed.unparsed).toHaveLength(1);
    expect(parsed.issues?.[0].reason).toBe('invalid_date');
    expect(parsed.unparsed[0]).toContain(date);
  });

  it('keeps rejected and debit rows separate from payments, including their exact two-digit days', () => {
    const parsed = parseMortgagePayments('28/03/2026 Receipt £1,382.36 Credit28/03/2026 Rejected Payment £1,382.36 Debit30/04/2026 Receipt -£1,382.36 Debit');
    expect(parsed.valid.map(payment => payment.date)).toEqual(['2026-03-28']);
    expect(parsed.skipped.map(({ date, reason }) => [date, reason])).toEqual([['2026-03-28', 'rejected'], ['2026-04-30', 'debit']]);
    expect(parsed.unparsed).toEqual([]);
  });
});

describe('mortgage statement payment amounts', () => {
  it.each(['£1,23.45', '£1,382.365', '£100.00.50', '£1e3', '£1 382.36', '£1,382 .36',
    '£1_382.36', '£100/2', '£100-50', '£100%', '£-100', '-£100', '(£100)', '£100)', '£0'])('does not silently book malformed or negative amount %s', amount => {
    const parsed = parseMortgagePayments(`30/09/2026 Receipt ${amount} Credit`);
    expect(parsed.valid).toEqual([]);
    expect(parsed.unparsed).toHaveLength(1);
    expect(parsed.issues?.[0].reason).toBe('invalid_amount');
  });

  it.each(['£100.00 £50.00', '£100.00 £bad'])('rejects multiple currency amounts instead of choosing one: %s', amounts => {
    const parsed = parseMortgagePayments(`30/09/2026 Receipt ${amounts} Credit`);
    expect(parsed.valid).toEqual([]);
    expect(parsed.issues?.[0].reason).toBe('ambiguous_amount');
  });

  it.each([['£1,000,000.01', '1000000.01'], ['£1382.36', '1382.36'], ['£ 1,382.3', '1382.30'], ['£100', '100.00']])('normalises valid whole amount %s', (amount, expected) => {
    expect(parseMortgagePayments(`30/09/2026 Receipt ${amount} Credit`).valid[0]?.amount).toBe(expected);
  });

  it('keeps non-payment text visible as an issue rather than pretending it was booked', () => {
    const parsed = parseMortgagePayments('Payment history: 30/09/2026 Receipt £1,861.22 Credit');
    expect(parsed.unparsed).toEqual(['Payment history:']);
    expect(parsed.issues?.[0].reason).toBe('missing_date');
    expect(parsed.valid[0]).toMatchObject({ date: '2026-09-30', amount: '1861.22' });
  });
});
