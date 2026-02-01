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
): Promise<ImportResult> {
  const config = getBankConfig(bankConfigName);
  if (!config) throw new Error(`Unknown bank config: ${bankConfigName}`);

  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  let transactions = await parseCSV(csvContent, config);
  transactions = await checkDuplicates(transactions, account.id);
  transactions = await categorizeTransactions(transactions);

  return importTransactions(transactions, account.id, bankConfigName, 'upload.csv');
}

export async function executeImportFromParsed(
  parsedTransactions: RawTransaction[],
  accountName: string,
): Promise<ImportResult> {
  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  // Check duplicates against existing data
  let transactions = await checkDuplicates(parsedTransactions, account.id);
  transactions = await categorizeTransactions(transactions);

  return importTransactions(transactions, account.id, 'pdf', 'upload.pdf');
}

async function importTransactions(
  transactions: RawTransaction[],
  accountId: number,
  bankConfig: string,
  filename: string,
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

  for (const txn of transactions) {
    if (txn.isDuplicate) {
      duplicates++;
      continue;
    }

    const journalId = await createJournalEntry(txn, accountId, batch.id);
    await fingerprintRepo.create({
      fingerprint: txn.fingerprint,
      accountId,
      journalEntryId: journalId,
    });
    imported++;
  }

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
