import { z } from 'zod';
import { NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';
import { apiHandler, validateBody, validateParams } from '@/lib/api/handler';
import { idParams } from '@/lib/api/schemas';

const bodySchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().min(1).max(100_000),
});

export const POST = apiHandler(async (req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const { role, content } = await validateBody(req, bodySchema);
  const message = await conversationRepo.addMessage(id, role, content);
  return NextResponse.json(message, { status: 201 });
});
