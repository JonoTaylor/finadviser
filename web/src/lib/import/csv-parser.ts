import Papa from 'papaparse';
import Decimal from 'decimal.js';
import { parse, format } from 'date-fns';
import { BankConfig } from '@/lib/config/bank-configs';
import { transactionFingerprint } from '@/lib/utils/hashing';
import type { RawTransaction, RawTransactionMetadata } from '@/lib/types';

// Columns we explicitly promote into typed fields on RawTransaction or
// RawTransactionMetadata. Anything in the row NOT listed here flows
// through to `metadata.raw` so future banks can ride the existing
// importer without a code change.
const PROMOTED_COLUMNS = new Set([
  'date', 'description', 'amount', 'debit', 'credit', 'reference',
  'externalId', 'time', 'type', 'merchantName', 'merchantEmoji',
  'bankCategory', 'currency', 'localAmount', 'localCurrency',
  'notes', 'address', 'receiptUrl', 'moneyOut', 'moneyIn',
]);

function cleanedString(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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

  // Parse amount. Banks that split into two columns may use the
  // generic `debit`/`credit` names OR more specific ones like Monzo's
  // "Money Out" / "Money In" — both work via the moneyOut/moneyIn
  // aliases on ColumnMapping.
  const debitCol = cols.debit ?? cols.moneyOut;
  const creditCol = cols.credit ?? cols.moneyIn;
  let amount: Decimal;
  if (cols.amount) {
    const amountStr = row[cols.amount]?.trim().replace(/,/g, '').replace('$', '').replace('£', '');
    if (!amountStr) return null;
    amount = new Decimal(amountStr).mul(config.amountMultiplier);
  } else if (debitCol && creditCol) {
    const debitStr = row[debitCol]?.trim().replace(/,/g, '').replace('$', '').replace('£', '') || '0';
    const creditStr = row[creditCol]?.trim().replace(/,/g, '').replace('$', '').replace('£', '') || '0';
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

  // Generate fingerprint. Prefer the bank's own external id when
  // present (Monzo's tx_… is globally unique) — that gives true dedup
  // regardless of date / amount jitter from edits / refunds.
  const externalId = cols.externalId ? cleanedString(row[cols.externalId]) : null;
  const fp = externalId ?? (await transactionFingerprint(parsedDate, amount.toString(), description));

  // Build metadata if the bank config exposes any of the optional
  // columns. We promote known fields onto typed properties; everything
  // else from the row spills into `raw` so future fields are
  // recoverable without a schema change.
  const metadata = buildMetadata(row, cols);

  return {
    date: parsedDate,
    description,
    amount: amount.toString(),
    reference,
    fingerprint: fp,
    isDuplicate: false,
    suggestedCategoryId: null,
    metadata,
  };
}

function buildMetadata(
  row: Record<string, string>,
  cols: import('@/lib/config/bank-configs').ColumnMapping,
): RawTransactionMetadata | null {
  const md: RawTransactionMetadata = {};
  if (cols.externalId)     md.externalId     = cleanedString(row[cols.externalId]);
  if (cols.time)           md.time           = cleanedString(row[cols.time]);
  if (cols.type)           md.type           = cleanedString(row[cols.type]);
  if (cols.merchantName)   md.merchantName   = cleanedString(row[cols.merchantName]);
  if (cols.merchantEmoji)  md.merchantEmoji  = cleanedString(row[cols.merchantEmoji]);
  if (cols.bankCategory)   md.bankCategory   = cleanedString(row[cols.bankCategory]);
  if (cols.currency)       md.currency       = cleanedString(row[cols.currency]);
  if (cols.localAmount)    md.localAmount    = cleanedString(row[cols.localAmount]);
  if (cols.localCurrency)  md.localCurrency  = cleanedString(row[cols.localCurrency]);
  if (cols.notes)          md.notes          = cleanedString(row[cols.notes]);
  if (cols.address)        md.address        = cleanedString(row[cols.address]);
  if (cols.receiptUrl)     md.receiptUrl     = cleanedString(row[cols.receiptUrl]);

  // Stash any column we didn't explicitly promote. Lets future banks
  // / future fields ride the existing importer until we're ready to
  // promote them to typed properties.
  const promotedHeaders = new Set<string>();
  for (const key of Object.keys(cols)) {
    if (!PROMOTED_COLUMNS.has(key)) continue;
    const header = cols[key as keyof typeof cols];
    if (typeof header === 'string') promotedHeaders.add(header);
  }
  const raw: Record<string, unknown> = {};
  for (const [header, value] of Object.entries(row)) {
    if (!promotedHeaders.has(header)) {
      const cleaned = cleanedString(value);
      if (cleaned !== null) raw[header] = cleaned;
    }
  }
  if (Object.keys(raw).length > 0) md.raw = raw;

  // Don't waste a row in transaction_metadata if literally nothing was
  // captured — keeps the table sparse for legacy importers.
  const hasAnything = Object.values(md).some(v => v !== undefined && v !== null);
  return hasAnything ? md : null;
}
