import { NextRequest, NextResponse } from 'next/server';
import { aiMemoryRepo, AI_MEMORY_MAX_CONTENT_LENGTH } from '@/lib/repos';
import { z } from 'zod';

const updateMemorySchema = z.object({
  content: z.string().trim().min(1).max(AI_MEMORY_MAX_CONTENT_LENGTH),
  expectedContent: z.string().min(1).max(AI_MEMORY_MAX_CONTENT_LENGTH),
}).strict();

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return NextResponse.json({ error: 'Invalid memory id' }, { status: 400 });
  }
  const parsed = updateMemorySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Supply a non-empty detail and the exact previously saved content.' }, { status: 400 });
  }
  try {
    const memory = await aiMemoryRepo.update(Number(id), parsed.data.content, parsed.data.expectedContent);
    if (!memory) {
      return NextResponse.json({ error: 'This detail changed or was removed. Reload the saved details before editing again.' }, { status: 409 });
    }
    return NextResponse.json(memory);
  } catch {
    return NextResponse.json({ error: 'The detail could not be saved. Your edit has not been confirmed.' }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const memoryId = Number(id);
    if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(memoryId)) {
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
