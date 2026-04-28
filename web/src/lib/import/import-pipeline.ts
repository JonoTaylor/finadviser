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

    // Booking convention: target account gets the bank-signed
    // amount unchanged; the contra is the opposite sign on
    // Uncategorized Income (positive bank rows) or Uncategorized
    // Expense (negative). The journal balances arithmetically
    // (createEntry trigger requires sum=0).
    //
    // This shape works for BOTH ASSET and LIABILITY targets in
    // this codebase's debit-positive / credit-negative convention:
    //   - ASSET target with -£50 (spend): target -50 (asset balance
    //     down, debit reduction), contra Uncat Expense +50 (expense
    //     up, debit increase). Correct.
    //   - LIABILITY target with -£50 (Yonder spend): target -50
    //     which is a credit on the liability (negative-on-liability
    //     = credit-normal balance growing), so the displayed debt
    //     via .abs() at calc-time goes UP by 50. Contra Uncat
    //     Expense +50 (expense up). Correct.
    //   - LIABILITY target with +£50 (statement payment received
    //     on the card): target +50 = debit reducing the liability
    //     (debt shrinks). Contra Uncat Income -50 - semantically
    //     wrong (this isn't income, it's a transfer-in from the
    //     payer's bank account) but the transfer reconciler
    //     auto-merges this with the bank-side -£50 debit when both
    //     have synced, replacing both with one balanced
    //     statement_payment journal.
    //
    // No per-account-type sign-flip needed at the importer.
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
