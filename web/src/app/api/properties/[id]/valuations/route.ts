import { z } from 'zod';
import { NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { apiHandler, validateBody, validateParams } from '@/lib/api/handler';
import { dateString, idParams, moneyString } from '@/lib/api/schemas';

const bodySchema = z.object({
  valuation: moneyString,
  valuationDate: dateString,
  source: z.string().max(50).optional().default('manual'),
});

export const POST = apiHandler(async (req, ctx) => {
  const { id } = await validateParams(ctx as { params: Promise<{ id: string }> }, idParams);
  const body = await validateBody(req, bodySchema);
  const valuation = await propertyRepo.addValuation(
    id,
    body.valuation,
    body.valuationDate,
    body.source,
  );
  return NextResponse.json(valuation, { status: 201 });
});
