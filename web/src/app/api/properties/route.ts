import { z } from 'zod';
import { propertyRepo } from '@/lib/repos';
import { apiHandler, validateBody } from '@/lib/api/handler';
import { dateString, moneyString } from '@/lib/api/schemas';
import { NextResponse } from 'next/server';

const createSchema = z.object({
  name: z.string().min(1).max(200),
  address: z.string().max(500).nullish(),
  purchaseDate: dateString.nullish(),
  purchasePrice: moneyString.nullish(),
});

export const GET = apiHandler(async () => propertyRepo.listProperties());

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, createSchema);
  const property = await propertyRepo.createProperty(body);
  return NextResponse.json(property, { status: 201 });
});
