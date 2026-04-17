import { z } from 'zod';
import { NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';

const createSchema = z.object({
  title: z.string().min(1).max(300),
});

export const GET = apiHandler(async () => conversationRepo.listConversations());

export const POST = apiHandler(async (req) => {
  const { title } = await validateBody(req, createSchema);
  const conversation = await conversationRepo.createConversation(title);
  return NextResponse.json(conversation, { status: 201 });
});
