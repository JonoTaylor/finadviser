import Decimal from 'decimal.js';
import { parseCSV } from './csv-parser';
import { checkDuplicates } from './duplicate-detector';
import { categorizeTransactions } from './categorizer';
import { accountRepo, journalRepo, fingerprintRepo, importBatchRepo, transactionMetadataRepo } from '@/lib/repos';
import { getBankConfig } from '@/lib/config/bank-configs';
import type { RawTransaction, ImportResult } from '@/lib/types';
import { deferredCategorization, processSavedTransactions, type IngestionCategorization } from './processing-hook';
import { reconcileTransfersForRun } from '@/lib/banking/sync';

export interface ProcessedImportResult extends ImportResult {
  categorization: IngestionCategorization & { preclassifiedCount: number };
}

type OnCategorization = (total: number) => void;

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
  onCategorization?: OnCategorization,
): Promise<ProcessedImportResult> {
  const config = getBankConfig(bankConfigName);
  if (!config) throw new Error(`Unknown bank config: ${bankConfigName}`);

  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  let transactions = await parseCSV(csvContent, config);
  transactions = await checkDuplicates(transactions, account.id);

  return importTransactions(transactions, account.id, bankConfigName, 'upload.csv', onProgress, onCategorization);
}

export async function executeImportFromParsed(
  parsedTransactions: RawTransaction[],
  accountName: string,
  onProgress?: (processed: number, total: number) => void,
  onCategorization?: OnCategorization,
): Promise<ProcessedImportResult> {
  const account = await accountRepo.getOrCreate(accountName, 'ASSET');

  // Check duplicates against existing data
  const transactions = await checkDuplicates(parsedTransactions, account.id);

  return importTransactions(transactions, account.id, 'pdf', 'upload.pdf', onProgress, onCategorization);
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
  onCategorization?: OnCategorization,
): Promise<ProcessedImportResult> {
  const startedAt = Date.now();
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
  const processingIds: number[] = [];

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
          // Preview suggestions are not confirmations. All new journals
          // go through the same context-aware, audited processing service.
          categoryId: null,
          importBatchId: batch.id,
        },
        entries: [
          { accountId, amount: amount.toString() },
          { accountId: otherAccountId, amount: amount.neg().toString() },
        ],
      };
    });

    const journalIds = await journalRepo.createEntriesBulk(items);

    for (let j = 0; j < chunk.length; j += 1) {
      if (processingIds.length < 2_000) {
        // Bound the scope, as well as the model pass. Any remainder is
        // still in the persistent queue and the daily processing pass.
        processingIds.push(journalIds[j]);
      }
    }

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

  // Keep this awaited: unawaited work can be discarded when a Vercel
  // function completes. The optional pass must never undo a saved import.
  onCategorization?.(imported);
  let transfersReconciled = imported === 0;
  let reconciliationDeferredReason = 'transfer_reconciliation_failed';
  const remainingImportBudget = () => 295_000 - (Date.now() - startedAt);
  if (imported > 0 && remainingImportBudget() >= 15_000) {
    try {
      // Imported rows have no sync-run ID. Use the existing idempotent
      // cross-account sweep before classifying a card or bank movement.
      await reconcileTransfersForRun(null, 3);
      transfersReconciled = true;
    } catch {
      console.warn('[import] Saved transactions await transfer reconciliation.');
    }
  } else if (imported > 0) {
    reconciliationDeferredReason = 'time_budget_exhausted';
  }
  const processingBudget = Math.min(15_000, remainingImportBudget());
  const categorization = processingBudget < 2_000
    ? deferredCategorization('time_budget_exhausted')
    : !transfersReconciled
      ? deferredCategorization(reconciliationDeferredReason)
      : await processSavedTransactions({
        journalIds: processingIds,
        source: 'import',
        limit: 50,
        modelTimeoutMs: Math.min(10_000, processingBudget),
        deadlineMs: processingBudget,
      });

  return {
    batchId: batch.id,
    importedCount: imported,
    duplicateCount: duplicates,
    totalCount: transactions.length,
    categorization: { ...categorization, preclassifiedCount: 0 },
  };
}
