import { NextRequest, NextResponse } from 'next/server';
import { previewImport } from '@/lib/import/import-pipeline';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const bankConfig = formData.get('bankConfig') as string;
    const accountName = formData.get('accountName') as string;

    if (!file) return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
    if (!bankConfig) return NextResponse.json({ error: 'Bank config required' }, { status: 400 });
    if (!accountName) return NextResponse.json({ error: 'Account name required' }, { status: 400 });

    const csvContent = await file.text();
    const transactions = await previewImport(csvContent, bankConfig, accountName);
    return NextResponse.json(transactions);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to preview import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
