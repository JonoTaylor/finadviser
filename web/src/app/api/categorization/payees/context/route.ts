import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { payeeLearningContextSchema } from '@/lib/categorization/payees/schema';
import { getPayeeLearningContext, InvalidPayeeMemoryError, PayeeMemoryConflictError } from '@/lib/categorization/payees/service';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const querySchema = z.object({ journalId: z.coerce.number().int().positive().max(2147483647) }).strict();

export async function GET(request: NextRequest) {
  const parsed = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!parsed.success) return json({ error: 'Choose one recorded transaction to remember.' }, 400);
  try { return json(payeeLearningContextSchema.parse(await getPayeeLearningContext(parsed.data.journalId))); }
  catch (error) {
    if (error instanceof PayeeMemoryConflictError) return json({ error: error.message }, 409);
    if (error instanceof InvalidPayeeMemoryError) return json({ error: error.message }, 422);
    return json({ error: 'This payment’s current account context could not be loaded. No meaning has been saved.' }, 503);
  }
}
