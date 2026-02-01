import { NextResponse } from 'next/server';
import { importBatchRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await importBatchRepo.listAll();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch batches' }, { status: 500 });
  }
}
