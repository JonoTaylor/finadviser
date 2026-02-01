import { NextRequest, NextResponse } from 'next/server';
import { executeImport } from '@/lib/import/import-pipeline';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await executeImport(body.csvContent, body.bankConfig, body.accountName);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to execute import';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
