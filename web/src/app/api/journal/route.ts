import { z } from 'zod';
import { journalRepo } from '@/lib/repos';
import { apiHandler, validateQuery } from '@/lib/api/handler';
import { dateString, optionalIntQuery } from '@/lib/api/schemas';

const querySchema = z.object({
  startDate: dateString.optional(),
  endDate: dateString.optional(),
  categoryId: optionalIntQuery,
  accountId: optionalIntQuery,
  q: z.string().max(200).optional(),
  limit: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n > 0 && n <= 500)
    .optional()
    .default(100),
  offset: z
    .string()
    .regex(/^\d+$/)
    .transform((v) => parseInt(v, 10))
    .refine((n) => n >= 0 && n <= 1_000_000)
    .optional()
    .default(0),
});

export const GET = apiHandler(async (req) => {
  const q = validateQuery(req, querySchema);
  const filters = {
    startDate: q.startDate,
    endDate: q.endDate,
    categoryId: q.categoryId,
    accountId: q.accountId,
    query: q.q,
    limit: q.limit,
    offset: q.offset,
  };
  const [entries, total] = await Promise.all([
    journalRepo.listEntries(filters),
    journalRepo.countEntries(filters),
  ]);
  return { entries, total };
});
