import { z } from 'zod';
import { NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';

const createSchema = z.object({
  name: z.string().min(1).max(200),
});

export const GET = apiHandler(async () => propertyRepo.listOwners());

export const POST = apiHandler(async (req) => {
  const { name } = await validateBody(req, createSchema);
  const owner = await propertyRepo.createOwner(name);
  return NextResponse.json(owner, { status: 201 });
});
