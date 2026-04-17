import { describe, it, expect } from 'vitest';
import { parseCSV } from './csv-parser';
import type { BankConfig } from '@/lib/config/bank-configs';

const config: BankConfig = {
  name: 'test',
  description: 'test config',
  dateFormat: 'DD/MM/YYYY',
  columns: { date: 'Date', description: 'Description', amount: 'Amount' },
  skipRows: 0,
  encoding: 'utf-8',
  delimiter: ',',
  signConvention: 'standard',
  amountMultiplier: 1.0,
};

describe('parseCSV', () => {
  it('parses a well-formed file into transactions', async () => {
    const csv = [
      'Date,Description,Amount',
      '01/04/2026,Tesco,-12.34',
      '02/04/2026,Salary,2500.00',
    ].join('\n');
    const { transactions, skipped } = await parseCSV(csv, config);
    expect(skipped).toEqual([]);
    expect(transactions).toHaveLength(2);
    expect(transactions[0]).toMatchObject({
      date: '2026-04-01',
      description: 'Tesco',
      amount: '-12.34',
    });
    expect(transactions[1]).toMatchObject({
      date: '2026-04-02',
      amount: '2500',
    });
    expect(typeof transactions[0].fingerprint).toBe('string');
    expect(transactions[0].fingerprint).toHaveLength(64);
  });

  it('records skipped rows with a reason when data is bad', async () => {
    const csv = [
      'Date,Description,Amount',
      '01/04/2026,Tesco,-12.34',
      'not-a-date,Foo,1.00',
      '03/04/2026,Bar,not-a-number',
      '04/04/2026,,5.00',
      '05/04/2026,Baz,',
    ].join('\n');
    const { transactions, skipped } = await parseCSV(csv, config);

    expect(transactions).toHaveLength(1);
    expect(skipped).toHaveLength(4);
    expect(skipped.map((s) => s.reason)).toEqual([
      expect.stringMatching(/Unparseable date/),
      expect.stringMatching(/Invalid amount/),
      expect.stringMatching(/Missing description/),
      expect.stringMatching(/Missing amount/),
    ]);
    // Row numbers should line up with the CSV (1-indexed, post-header).
    expect(skipped[0].rowNumber).toBeGreaterThan(1);
  });

  it('applies the inverted sign convention', async () => {
    const inverted: BankConfig = { ...config, signConvention: 'inverted' };
    const csv = 'Date,Description,Amount\n01/04/2026,Tesco,-12.34';
    const { transactions } = await parseCSV(csv, inverted);
    expect(transactions[0].amount).toBe('12.34');
  });

  it('supports debit/credit split columns', async () => {
    const split: BankConfig = {
      ...config,
      columns: { date: 'Date', description: 'Description', debit: 'Debit', credit: 'Credit' },
    };
    const csv = [
      'Date,Description,Debit,Credit',
      '01/04/2026,Tesco,12.34,',
      '02/04/2026,Salary,,2500.00',
    ].join('\n');
    const { transactions, skipped } = await parseCSV(csv, split);
    expect(skipped).toEqual([]);
    expect(transactions[0].amount).toBe('-12.34');
    expect(transactions[1].amount).toBe('2500');
  });
});
