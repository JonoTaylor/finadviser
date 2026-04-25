import { NextRequest, NextResponse } from 'next/server';
import { executeImport, executeImportFromParsed } from '@/lib/import/import-pipeline';
import { ndjsonStream } from '@/lib/import/stream';
import type { RawTransaction } from '@/lib/types';

/**
 * Streaming import. Per-row progress events are emitted during the save
 * phase (the slow part: bulk-insert journals + book entries + fingerprints
 * in chunks of 100). The final event is
 * { phase: 'done', result: { batchId, importedCount, duplicateCount, totalCount } }.
 *
 * Phase events around dedupe / categorise are emitted too so the UI label
 * stays accurate while the server isn't yet in the saving phase.
 */
export async function POST(request: NextRequest) {
  let body: {
    parsedTransactions?: unknown;
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

  if (body.parsedTransactions !== undefined && !Array.isArray(body.parsedTransactions)) {
    return NextResponse.json(
      { error: 'parsedTransactions must be an array' },
      { status: 400 },
    );
  }
  if (!body.parsedTransactions && (!body.csvContent || !body.bankConfig)) {
    return NextResponse.json(
      { error: 'Either parsedTransactions or csvContent + bankConfig are required' },
      { status: 400 },
    );
  }
  if (!body.accountName) {
    return NextResponse.json({ error: 'accountName is required' }, { status: 400 });
  }
  const accountName = body.accountName;

  return ndjsonStream(async (emit) => {
    if (Array.isArray(body.parsedTransactions)) {
      // PDF flow: pre-parsed transactions arrive from the preview step.
      // We don't know the post-dedupe total yet, so we leave the bar as
      // indeterminate via 'checking-duplicates' until executeImportFromParsed
      // emits the first concrete (processed, total) saving event.
      const parsed = body.parsedTransactions as RawTransaction[];
      emit({ phase: 'checking-duplicates', total: parsed.length });
      emit({ phase: 'categorising', total: parsed.length });
      const result = await executeImportFromParsed(
        parsed,
        accountName,
        (processed, total) => emit({ phase: 'saving', processed, total }),
      );
      emit({ phase: 'done', result });
      return;
    }

    // CSV flow.
    if (!body.csvContent || !body.bankConfig) {
      // Already validated above, but narrow types here.
      throw new Error('csvContent and bankConfig are required');
    }

    emit({ phase: 'parsing' });
    // executeImport internally does parse → dedupe → categorise → save.
    // We can't intercept the intermediate phases without refactoring
    // executeImport itself, so for the CSV path we emit a single
    // 'checking-duplicates' indeterminate transition before saving
    // begins. Saving emits real per-row progress.
    emit({ phase: 'checking-duplicates', total: 0 });
    const result = await executeImport(
      body.csvContent,
      body.bankConfig,
      accountName,
      (processed, total) => emit({ phase: 'saving', processed, total }),
    );
    emit({ phase: 'done', result });
  });
}
