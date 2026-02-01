import Papa from 'papaparse';
import Decimal from 'decimal.js';
import { parse, format } from 'date-fns';
import { BankConfig } from '@/lib/config/bank-configs';
import { transactionFingerprint } from '@/lib/utils/hashing';
import type { RawTransaction } from '@/lib/types';

function parseDateFormat(dateStr: string, dateFormat: string): string {
  // Convert Python-style format to date-fns format
  const fnsFormat = dateFormat
    .replace('%d', 'dd')
    .replace('%m', 'MM')
    .replace('%Y', 'yyyy')
    .replace('%y', 'yy')
    .replace('DD', 'dd')
    .replace('YYYY', 'yyyy')
    .replace('MM', 'MM');

  const parsed = parse(dateStr.trim(), fnsFormat, new Date());
  return format(parsed, 'yyyy-MM-dd');
}

export async function parseCSV(
  csvContent: string,
  config: BankConfig,
): Promise<RawTransaction[]> {
  const result = Papa.parse(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  // Skip configured rows
  const rows = result.data.slice(config.skipRows) as Record<string, string>[];
  const transactions: RawTransaction[] = [];

  for (const row of rows) {
    try {
      const txn = await parseRow(row, config);
      if (txn) transactions.push(txn);
    } catch {
      continue;
    }
  }

  return transactions;
}

async function parseRow(
  row: Record<string, string>,
  config: BankConfig,
): Promise<RawTransaction | null> {
  const cols = config.columns;

  // Parse date
  const dateStr = row[cols.date]?.trim();
  if (!dateStr) return null;
  const parsedDate = parseDateFormat(dateStr, config.dateFormat);

  // Parse description
  const description = row[cols.description]?.trim();
  if (!description) return null;

  // Parse amount
  let amount: Decimal;
  if (cols.amount) {
    const amountStr = row[cols.amount]?.trim().replace(/,/g, '').replace('$', '').replace('£', '');
    if (!amountStr) return null;
    amount = new Decimal(amountStr).mul(config.amountMultiplier);
  } else if (cols.debit && cols.credit) {
    const debitStr = row[cols.debit]?.trim().replace(/,/g, '').replace('$', '').replace('£', '') || '0';
    const creditStr = row[cols.credit]?.trim().replace(/,/g, '').replace('$', '').replace('£', '') || '0';
    const debit = debitStr && debitStr !== '' ? new Decimal(debitStr) : new Decimal(0);
    const credit = creditStr && creditStr !== '' ? new Decimal(creditStr) : new Decimal(0);
    amount = credit.minus(debit);
  } else {
    return null;
  }

  if (config.signConvention === 'inverted') {
    amount = amount.neg();
  }

  // Parse optional reference
  let reference: string | null = null;
  if (cols.reference) {
    const refVal = row[cols.reference]?.trim();
    if (refVal) reference = refVal;
  }

  // Generate fingerprint
  const fp = await transactionFingerprint(parsedDate, amount.toString(), description);

  return {
    date: parsedDate,
    description,
    amount: amount.toString(),
    reference,
    fingerprint: fp,
    isDuplicate: false,
    suggestedCategoryId: null,
  };
}
