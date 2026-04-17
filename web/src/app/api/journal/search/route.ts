import { z } from 'zod';
import { journalRepo } from '@/lib/repos';
import { apiHandler, validateQuery } from '@/lib/api/handler';

const querySchema = z.object({
  q: z.string().max(200).default(''),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n > 0 && n <= 500)
    .optional()
    .default(50),
});

export const GET = apiHandler(async (req) => {
  const { q, limit } = validateQuery(req, querySchema);
  return journalRepo.search(q, limit);
});
