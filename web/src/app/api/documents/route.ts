import { NextResponse } from 'next/server';
import { documentRepo } from '@/lib/repos';

export async function GET() {
  try {
    const docs = await documentRepo.list();
    return NextResponse.json(docs);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list documents';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
