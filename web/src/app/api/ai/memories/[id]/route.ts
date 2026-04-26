import { NextRequest, NextResponse } from 'next/server';
import { aiMemoryRepo } from '@/lib/repos';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const memoryId = parseInt(id, 10);
    if (Number.isNaN(memoryId)) {
      return NextResponse.json({ error: 'Invalid memory id' }, { status: 400 });
    }
    const deleted = await aiMemoryRepo.delete(memoryId);
    if (!deleted) {
      return NextResponse.json({ error: 'Memory not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete memory';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
