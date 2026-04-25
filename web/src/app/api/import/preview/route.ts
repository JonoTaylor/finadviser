import { NextRequest, NextResponse } from 'next/server';
import { parseCSV } from '@/lib/import/csv-parser';
import { checkDuplicates } from '@/lib/import/duplicate-detector';
import { categorizeTransactions } from '@/lib/import/categorizer';
import { accountRepo } from '@/lib/repos';
import { getBankConfig } from '@/lib/config/bank-configs';
import { ndjsonStream } from '@/lib/import/stream';

/**
 * Streaming preview. Each phase emits an NDJSON line so the client can
 * render real progress. Final event is { phase: 'done', result: txns }.
 *
 * Why not just return JSON: a 5,000-row CSV preview can take many seconds
 * (parse + bulk dedupe lookup + rule matching). Without progress events
 * the user sees a frozen button. This way the bar moves and labels
 * change as each phase completes.
 */
export async function POST(request: NextRequest) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid form data' },
      { status: 400 },
    );
  }

  const file = formData.get('file') as File | null;
  const bankConfig = (formData.get('bankConfig') as string | null) ?? '';
  const accountName = (formData.get('accountName') as string | null) ?? '';

  if (!file) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }

  const isPdf = file.name.toLowerCase().endsWith('.pdf') || bankConfig === 'pdf';

  return ndjsonStream(async (emit) => {
    emit({ phase: 'parsing' });

    if (isPdf) {
      // Dynamic import — pdf-parse + pdfjs-dist crash Vercel if loaded at
      // module init.
      const { parsePDF } = await import('@/lib/import/pdf-parser');
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      let transactions = await parsePDF(buffer);
      emit({ phase: 'parsed', total: transactions.length });
      emit({ phase: 'categorising', total: transactions.length });
      transactions = await categorizeTransactions(transactions);
      emit({ phase: 'done', result: transactions });
      return;
    }

    if (!bankConfig) throw new Error('Bank config required');
    if (!accountName) throw new Error('Account name required');

    const config = getBankConfig(bankConfig);
    if (!config) throw new Error(`Unknown bank config: ${bankConfig}`);

    const csvContent = await file.text();
    let transactions = await parseCSV(csvContent, config);
    emit({ phase: 'parsed', total: transactions.length });

    const account = await accountRepo.getByName(accountName);
    if (account?.id) {
      emit({ phase: 'checking-duplicates', total: transactions.length });
      transactions = await checkDuplicates(transactions, account.id);
    }

    emit({ phase: 'categorising', total: transactions.length });
    transactions = await categorizeTransactions(transactions);

    emit({ phase: 'done', result: transactions });
  });
}
