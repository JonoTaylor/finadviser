import { NextRequest, NextResponse } from 'next/server';
import { executeImport, executeImportFromParsed } from '@/lib/import/import-pipeline';
import { ndjsonStream } from '@/lib/import/stream';

/**
 * Streaming import. Per-row progress events are emitted during the save
 * phase (the slow part: one journal-entry insert per non-duplicate row,
 * plus a balance-check trigger). The final event is
 * { phase: 'done', result: { batchId, importedCount, duplicateCount, totalCount } }.
 */
export async function POST(request: NextRequest) {
  let body: {
    parsedTransactions?: unknown[];
    csvContent?: string;
    bankConfig?: string;
    accountName?: string;
  };
  try {
    body = await request.json();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid JSON body' },
      { status: 400 },
    );
  }

  return ndjsonStream(async (emit) => {
    if (body.parsedTransactions) {
      // PDF flow: pre-parsed transactions arrive from the preview step.
      // Saving is the only slow phase here (dedupe + categorise are fast
      // now that the duplicate detector uses one bulk lookup).
      emit({ phase: 'saving', processed: 0, total: body.parsedTransactions.length });
      const result = await executeImportFromParsed(
        body.parsedTransactions as Parameters<typeof executeImportFromParsed>[0],
        body.accountName ?? '',
        (processed, total) => emit({ phase: 'saving', processed, total }),
      );
      emit({ phase: 'done', result });
      return;
    }

    if (!body.csvContent || !body.bankConfig || !body.accountName) {
      throw new Error('csvContent, bankConfig, and accountName are required');
    }

    emit({ phase: 'parsing' });
    const result = await executeImport(
      body.csvContent,
      body.bankConfig,
      body.accountName,
      (processed, total) => emit({ phase: 'saving', processed, total }),
    );
    emit({ phase: 'done', result });
  });
}
