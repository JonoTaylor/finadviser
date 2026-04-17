import { z } from 'zod';
import { NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';
import { idNumber } from '@/lib/api/schemas';

const createSchema = z.object({
  name: z.string().min(1).max(100),
  parentId: idNumber.nullish(),
  isSystem: z.boolean().optional(),
});

export const GET = apiHandler(async () => categoryRepo.listAll());

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, createSchema);
  const category = await categoryRepo.create(body);
  return NextResponse.json(category, { status: 201 });
});
