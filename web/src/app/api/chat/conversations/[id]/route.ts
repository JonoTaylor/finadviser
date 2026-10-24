import { NextRequest, NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';
import { z } from 'zod';

const idSchema = z.coerce.number().int().positive().max(2147483647);
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = idSchema.safeParse(id);
    if (!parsed.success) return json({ error: 'Use a valid conversation ID.' }, 400);
    if (!await conversationRepo.getConversationById(parsed.data)) return json({ error: 'Conversation not found.' }, 404);
    const messages = await conversationRepo.getMessages(parsed.data);
    return json(messages);
  } catch {
    return json({ error: 'Saved messages could not be loaded. Retry before assuming the conversation is empty.' }, 503);
  }
}
