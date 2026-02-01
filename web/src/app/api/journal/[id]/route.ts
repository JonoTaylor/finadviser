import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const entry = await journalRepo.getEntry(parseInt(id));
    if (!entry) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    const bookEntries = await journalRepo.getBookEntries(parseInt(id));
    return NextResponse.json({ ...entry, bookEntries });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch entry' }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    if (body.categoryId !== undefined) {
      await journalRepo.updateCategory(parseInt(id), body.categoryId);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update entry' }, { status: 500 });
  }
}
