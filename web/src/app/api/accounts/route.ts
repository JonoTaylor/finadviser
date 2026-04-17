import { z } from 'zod';
import { NextResponse } from 'next/server';
import { accountRepo } from '@/lib/repos';
import { apiHandler, validateBody, validateQuery } from '@/lib/api/handler';
import { accountType, idNumber } from '@/lib/api/schemas';

const querySchema = z.object({
  balances: z.enum(['true', 'false']).optional(),
  type: accountType.optional(),
});

const createSchema = z.object({
  name: z.string().min(1).max(200),
  accountType,
  parentId: idNumber.nullish(),
  description: z.string().max(1000).nullish(),
  isSystem: z.boolean().optional(),
});

export const GET = apiHandler(async (req) => {
  const { balances, type } = validateQuery(req, querySchema);
  if (balances === 'true') return accountRepo.getBalances();
  if (type) return accountRepo.listByType(type);
  return accountRepo.listAll();
});

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, createSchema);
  const account = await accountRepo.create(body);
  return NextResponse.json(account, { status: 201 });
});
