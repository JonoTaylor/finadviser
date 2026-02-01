import { NextRequest, NextResponse } from 'next/server';
import { previewImport } from '@/lib/import/import-pipeline';
import { categorizeTransactions } from '@/lib/import/categorizer';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bankConfig = formData.get('bankConfig') as string;
    const accountName = formData.get('accountName') as string;

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });

    const isPdf = file.name.toLowerCase().endsWith('.pdf') || bankConfig === 'pdf';

    if (isPdf) {
      // Dynamic import — pdf-parse + pdfjs-dist crash Vercel if loaded at module init
      const { parsePDF } = await import('@/lib/import/pdf-parser');
      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      let transactions = await parsePDF(buffer);
      transactions = await categorizeTransactions(transactions);
      return NextResponse.json(transactions);
    }

    // CSV flow: existing pipeline
    if (!bankConfig) return NextResponse.json({ error: 'Bank config required' }, { status: 400 });
    if (!accountName) return NextResponse.json({ error: 'Account name required' }, { status: 400 });

    const csvContent = await file.text();
    const transactions = await previewImport(csvContent, bankConfig, accountName);
    return NextResponse.json(transactions);
  } catch (error) {
    console.error('[import/preview]', error);
    const message = error instanceof Error ? error.message : 'Failed to preview import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
