import { NextRequest, NextResponse } from 'next/server';
import { documentRepo } from '@/lib/repos';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const docId = parseInt(id, 10);
    if (Number.isNaN(docId)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    const meta = await documentRepo.getMeta(docId);
    if (!meta) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    return NextResponse.json(meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load document';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const docId = parseInt(id, 10);
    if (Number.isNaN(docId)) return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    await documentRepo.delete(docId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete document';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
