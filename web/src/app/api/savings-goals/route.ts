import { z } from 'zod';
import { savingsGoalRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';
import { dateString, idNumber, moneyString } from '@/lib/api/schemas';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  targetAmount: moneyString,
  currentAmount: moneyString.optional(),
  targetDate: dateString.nullish(),
  accountId: idNumber.nullish(),
});

const updateSchema = z.object({
  id: idNumber,
  name: z.string().min(1).max(200).optional(),
  targetAmount: moneyString.optional(),
  currentAmount: moneyString.optional(),
  targetDate: dateString.nullish(),
  accountId: idNumber.nullish(),
  status: z.enum(['active', 'completed', 'cancelled']).optional(),
});

export const GET = apiHandler(async () => savingsGoalRepo.getAll());

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, createSchema);
  return savingsGoalRepo.create({
    name: body.name,
    targetAmount: body.targetAmount,
    currentAmount: body.currentAmount,
    targetDate: body.targetDate ?? null,
    accountId: body.accountId ?? null,
  });
});

export const PATCH = apiHandler(async (req) => {
  const { id, ...data } = await validateBody(req, updateSchema);
  return savingsGoalRepo.update(id, data);
});
