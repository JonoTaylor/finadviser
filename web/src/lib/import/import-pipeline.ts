import Decimal from 'decimal.js';
import { parseCSV } from './csv-parser';
import { checkDuplicates } from './duplicate-detector';
import { categorizeTransactions } from './categorizer';
import { accountRepo, journalRepo, fingerprintRepo, importBatchRepo } from '@/lib/repos';
import { getBankConfig } from '@/lib/config/bank-configs';
import type { RawTransaction, ImportResult } from '@/lib/types';

export async function previewImport(
  csvContent: string,
  bankConfigName: string,
  accountName: string,
): Promise<RawTransaction[]> {
  const config = getBankConfig(bankConfigName);
  if (!config) throw new Error(`Unknown bank config: ${bankConfigName}`);

  const account = await accountRepo.getByName(accountName);
  const accountId = account?.id ?? 0;

  let transactions = await parseCSV(csvContent, config);
  if (accountId) {
    transactions = await checkDuplicates(transactions, accountId);
  }
  transactions = await categorizeTransactions(transactions);

  return transactions;
}

export async function executeImport(
  csvContent: string,
  bankConfigName: string,
  accountName: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<ImportResult> {
  const config = getBankConfig(bankConfigName);
  if (!config) throw new Error(`Unknown bank config: ${bankConfigName}`);

  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  let transactions = await parseCSV(csvContent, config);
  transactions = await checkDuplicates(transactions, account.id);
  transactions = await categorizeTransactions(transactions);

  return importTransactions(transactions, account.id, bankConfigName, 'upload.csv', onProgress);
}

export async function executeImportFromParsed(
  parsedTransactions: RawTransaction[],
  accountName: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<ImportResult> {
  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  // Check duplicates against existing data
  let transactions = await checkDuplicates(parsedTransactions, account.id);
  transactions = await categorizeTransactions(transactions);

  return importTransactions(transactions, account.id, 'pdf', 'upload.pdf', onProgress);
}

async function importTransactions(
  transactions: RawTransaction[],
  accountId: number,
  bankConfig: string,
  filename: string,
  onProgress?: (processed: number, total: number) => void,
): Promise<ImportResult> {
  // Create import batch
  const batch = await importBatchRepo.create({
    filename,
    bankConfig,
    accountId,
    rowCount: transactions.length,
  });

  let imported = 0;
  let duplicates = 0;

  // Collect fingerprint inserts so we can bulk-write them at the end
  // instead of one round-trip per row. Journal creation has to be one
  // call per row (the balance trigger validates the journal during
  // INSERT) so we batch what we can.
  const fingerprintRows: Array<{ fingerprint: string; accountId: number; journalEntryId: number }> = [];

  // Total of non-duplicate rows for progress reporting; matches what we
  // actually save, not the input length. Throttle progress events so a
  // huge import doesn't flood the stream — at most ~100 events.
  const total = transactions.filter(t => !t.isDuplicate).length;
  let processed = 0;
  const progressEvery = Math.max(1, Math.floor(total / 100));

  for (const txn of transactions) {
    if (txn.isDuplicate) {
      duplicates++;
      continue;
    }

    const journalId = await createJournalEntry(txn, accountId, batch.id);
    fingerprintRows.push({
      fingerprint: txn.fingerprint,
      accountId,
      journalEntryId: journalId,
    });
    imported++;
    processed++;
    if (onProgress && (processed % progressEvery === 0 || processed === total)) {
      onProgress(processed, total);
    }
  }

  await fingerprintRepo.createMany(fingerprintRows);
  await importBatchRepo.updateCounts(batch.id, imported, duplicates);

  return {
    batchId: batch.id,
    importedCount: imported,
    duplicateCount: duplicates,
    totalCount: transactions.length,
  };
}

async function createJournalEntry(
  txn: RawTransaction,
  accountId: number,
  batchId: number,
): Promise<number> {
  const amount = new Decimal(txn.amount);

  let entries: Array<{ accountId: number; amount: string }>;

  if (amount.gte(0)) {
    const incomeAccount = await accountRepo.getOrCreate('Uncategorized Income', 'INCOME');
    entries = [
      { accountId, amount: amount.toString() },
      { accountId: incomeAccount.id, amount: amount.neg().toString() },
    ];
  } else {
    const expenseAccount = await accountRepo.getOrCreate('Uncategorized Expense', 'EXPENSE');
    entries = [
      { accountId, amount: amount.toString() },
      { accountId: expenseAccount.id, amount: amount.neg().toString() },
    ];
  }

  return journalRepo.createEntry(
    {
      date: txn.date,
      description: txn.description,
      reference: txn.reference,
      categoryId: txn.suggestedCategoryId,
      importBatchId: batchId,
    },
    entries,
  );
}
