import { NextRequest, NextResponse } from 'next/server';
import { executeImport, executeImportFromParsed } from '@/lib/import/import-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // PDF flow: pre-parsed transactions
    if (body.parsedTransactions) {
      const result = await executeImportFromParsed(body.parsedTransactions, body.accountName);
      return NextResponse.json(result);
    }

    // CSV flow: parse from raw content
    const result = await executeImport(body.csvContent, body.bankConfig, body.accountName);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
