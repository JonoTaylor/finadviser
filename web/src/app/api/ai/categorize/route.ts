import { z } from 'zod';
import { categorizeBatch } from '@/lib/ai/claude-client';
import { apiHandler, validateBody } from '@/lib/api/handler';

const bodySchema = z.object({
  descriptions: z.array(z.string().min(1).max(500)).min(1).max(500),
  categories: z.array(z.string().min(1).max(100)).min(1).max(200),
});

export const POST = apiHandler(async (req) => {
  const { descriptions, categories } = await validateBody(req, bodySchema);
  return categorizeBatch(descriptions, categories);
});
