import { z } from 'zod';
import { budgetRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';
import { dateString, idNumber, moneyString } from '@/lib/api/schemas';

const createSchema = z.object({
  categoryId: idNumber,
  monthlyLimit: moneyString,
  effectiveFrom: dateString,
});

export const GET = apiHandler(async () => budgetRepo.getAll());

export const POST = apiHandler(async (req) => {
  const { categoryId, monthlyLimit, effectiveFrom } = await validateBody(req, createSchema);
  return budgetRepo.upsert(categoryId, monthlyLimit, effectiveFrom);
});
