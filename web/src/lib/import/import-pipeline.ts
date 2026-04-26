import Decimal from 'decimal.js';
import { parseCSV } from './csv-parser';
import { checkDuplicates } from './duplicate-detector';
import { categorizeTransactions } from './categorizer';
import { accountRepo, journalRepo, fingerprintRepo, importBatchRepo, transactionMetadataRepo } from '@/lib/repos';
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

// Chunk size for bulk inserts. Postgres' parameter limit (~65k) is way
// above this; the limit here is more about memory + giving the user
// progress updates that aren't too lumpy. 100 rows per chunk → 4 SQL
// inserts per chunk (1 journal-bulk + 1 book-entry-bulk + 1 fingerprint-
// bulk + the per-chunk progress event) ≈ ~600ms per 100 rows on Neon.
const CHUNK_SIZE = 100;

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

  // Pre-fetch the two system accounts ONCE. Previously these were
  // looked up via accountRepo.getOrCreate inside every row, which was
  // ~2 round-trips per row and the dominant cause of the 300s timeout
  // we saw on a real import.
  const [incomeAccount, expenseAccount] = await Promise.all([
    accountRepo.getOrCreate('Uncategorized Income', 'INCOME'),
    accountRepo.getOrCreate('Uncategorized Expense', 'EXPENSE'),
  ]);

  const nonDup = transactions.filter(t => !t.isDuplicate);
  const total = nonDup.length;
  const duplicates = transactions.length - nonDup.length;
  let imported = 0;

  // Emit a 0/total event at the start so the UI shows a determinate
  // bar from the moment saving begins, not after the first chunk.
  onProgress?.(0, total);

  for (let i = 0; i < nonDup.length; i += CHUNK_SIZE) {
    const chunk = nonDup.slice(i, i + CHUNK_SIZE);

    const items = chunk.map(txn => {
      const amount = new Decimal(txn.amount);
      const otherAccountId = amount.gte(0) ? incomeAccount.id : expenseAccount.id;
      return {
        journal: {
          date: txn.date,
          description: txn.description,
          reference: txn.reference,
          categoryId: txn.suggestedCategoryId,
          importBatchId: batch.id,
        },
        entries: [
          { accountId, amount: amount.toString() },
          { accountId: otherAccountId, amount: amount.neg().toString() },
        ],
      };
    });

    const journalIds = await journalRepo.createEntriesBulk(items);

    await fingerprintRepo.createMany(
      chunk.map((txn, j) => ({
        fingerprint: txn.fingerprint,
        accountId,
        journalEntryId: journalIds[j],
      })),
    );

    // Persist any optional per-transaction metadata (Monzo type /
    // merchant / emoji / notes / receipt etc.). Sparse — rows
    // without metadata are skipped so legacy importers cost nothing.
    const metadataRows = chunk
      .map((txn, j) => {
        const md = txn.metadata;
        if (!md) return null;
        return {
          journalEntryId: journalIds[j],
          externalId: md.externalId ?? null,
          transactionTime: md.time ?? null,
          transactionType: md.type ?? null,
          merchantName: md.merchantName ?? null,
          merchantEmoji: md.merchantEmoji ?? null,
          bankCategory: md.bankCategory ?? null,
          currency: md.currency ?? null,
          localAmount: md.localAmount ?? null,
          localCurrency: md.localCurrency ?? null,
          notes: md.notes ?? null,
          address: md.address ?? null,
          receiptUrl: md.receiptUrl ?? null,
          raw: md.raw ?? null,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
    if (metadataRows.length > 0) {
      await transactionMetadataRepo.createMany(metadataRows);
    }

    imported += chunk.length;
    onProgress?.(imported, total);
  }

  await importBatchRepo.updateCounts(batch.id, imported, duplicates);

  return {
    batchId: batch.id,
    importedCount: imported,
    duplicateCount: duplicates,
    totalCount: transactions.length,
  };
}
