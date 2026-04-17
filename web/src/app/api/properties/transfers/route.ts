import { z } from 'zod';
import { NextResponse } from 'next/server';
import { transferEquity } from '@/lib/properties/transfer-engine';
import { propertyRepo } from '@/lib/repos';
import { apiHandler, validateBody, validateQuery } from '@/lib/api/handler';
import { dateString, idNumber, moneyString, optionalIntQuery } from '@/lib/api/schemas';

const querySchema = z.object({
  propertyId: optionalIntQuery,
  ownerId: optionalIntQuery,
});

const bodySchema = z.object({
  fromPropertyId: idNumber,
  toPropertyId: idNumber,
  ownerId: idNumber,
  amount: moneyString,
  transferDate: dateString,
  description: z.string().max(500).optional(),
});

export const GET = apiHandler(async (req) => {
  const { propertyId, ownerId } = validateQuery(req, querySchema);
  return propertyRepo.getTransfers(propertyId, ownerId);
});

export const POST = apiHandler(async (req) => {
  const body = await validateBody(req, bodySchema);
  const journalId = await transferEquity(body);
  return NextResponse.json({ journalId }, { status: 201 });
});
