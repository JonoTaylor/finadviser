import Papa from 'papaparse';
import Decimal from 'decimal.js';
import { parse, format, isValid } from 'date-fns';
import { BankConfig } from '@/lib/config/bank-configs';
import { transactionFingerprint } from '@/lib/utils/hashing';
import type { ParsePreview, RawTransaction, SkippedRow } from '@/lib/types';

function parseDateFormat(dateStr: string, dateFormat: string): string | null {
  const fnsFormat = dateFormat
    .replace('%d', 'dd')
    .replace('%m', 'MM')
    .replace('%Y', 'yyyy')
    .replace('%y', 'yy')
    .replace('DD', 'dd')
    .replace('YYYY', 'yyyy')
    .replace('MM', 'MM');

  const parsed = parse(dateStr.trim(), fnsFormat, new Date());
  if (!isValid(parsed)) return null;
  return format(parsed, 'yyyy-MM-dd');
}

function stripAmount(s: string): string {
  return s.trim().replace(/,/g, '').replace('$', '').replace('£', '');
}

export async function parseCSV(
  csvContent: string,
  config: BankConfig,
): Promise<ParsePreview> {
  const result = Papa.parse<Record<string, string>>(csvContent, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h: string) => h.trim(),
  });

  const rows = result.data.slice(config.skipRows);
  const transactions: RawTransaction[] = [];
  const skipped: SkippedRow[] = [];

  let rowNumber = config.skipRows + 1; // 1-indexed, post-header
  for (const row of rows) {
    rowNumber++;
    try {
      const parsed = await parseRow(row, config);
      if (parsed.ok) {
        transactions.push(parsed.txn);
      } else {
        skipped.push({ rowNumber, reason: parsed.reason });
      }
    } catch (err) {
      skipped.push({
        rowNumber,
        reason: err instanceof Error ? err.message : 'Unknown parse error',
      });
    }
  }

  return { transactions, skipped };
}

type RowParseResult =
  | { ok: true; txn: RawTransaction }
  | { ok: false; reason: string };

async function parseRow(
  row: Record<string, string>,
  config: BankConfig,
): Promise<RowParseResult> {
  const cols = config.columns;

  const dateStr = row[cols.date]?.trim();
  if (!dateStr) return { ok: false, reason: `Missing date column (${cols.date})` };
  const parsedDate = parseDateFormat(dateStr, config.dateFormat);
  if (!parsedDate) {
    return { ok: false, reason: `Unparseable date "${dateStr}" (expected ${config.dateFormat})` };
  }

  const description = row[cols.description]?.trim();
  if (!description) return { ok: false, reason: `Missing description column (${cols.description})` };

  let amount: Decimal;
  if (cols.amount) {
    const amountStr = stripAmount(row[cols.amount] ?? '');
    if (!amountStr) return { ok: false, reason: `Missing amount column (${cols.amount})` };
    try {
      amount = new Decimal(amountStr).mul(config.amountMultiplier);
    } catch {
      return { ok: false, reason: `Invalid amount "${amountStr}"` };
    }
  } else if (cols.debit && cols.credit) {
    const debitStr = stripAmount(row[cols.debit] ?? '') || '0';
    const creditStr = stripAmount(row[cols.credit] ?? '') || '0';
    try {
      const debit = new Decimal(debitStr);
      const credit = new Decimal(creditStr);
      amount = credit.minus(debit);
    } catch {
      return { ok: false, reason: `Invalid debit/credit "${debitStr}"/"${creditStr}"` };
    }
  } else {
    return { ok: false, reason: 'Bank config has no amount (or debit/credit) column' };
  }

  if (config.signConvention === 'inverted') {
    amount = amount.neg();
  }

  let reference: string | null = null;
  if (cols.reference) {
    const refVal = row[cols.reference]?.trim();
    if (refVal) reference = refVal;
  }

  const fp = await transactionFingerprint(parsedDate, amount.toString(), description);

  return {
    ok: true,
    txn: {
      date: parsedDate,
      description,
      amount: amount.toString(),
      reference,
      fingerprint: fp,
      isDuplicate: false,
      suggestedCategoryId: null,
    },
  };
}
