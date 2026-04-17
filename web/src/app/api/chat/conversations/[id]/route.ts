import { conversationRepo } from '@/lib/repos';
import { apiHandler, validateParams } from '@/lib/api/handler';
import { idParams } from '@/lib/api/schemas';

export const GET = apiHandler(async (_req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  return conversationRepo.getMessages(id);
});
