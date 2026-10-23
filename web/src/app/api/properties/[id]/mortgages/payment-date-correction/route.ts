import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { ClientError, NotFoundError } from '@/lib/errors';
import {
  correctMortgagePaymentDate, isMortgagePaymentIsoDate,
  MortgageDateCorrectionConflictError, previewMortgagePaymentDateCorrection,
} from '@/lib/properties/mortgage-payment-date-review';

const idSchema = z.coerce.number().int().positive().max(2147483647);
const requestSchema = z.object({
  mortgageId: idSchema,
  journalId: idSchema,
  correctDate: z.string().refine(isMortgagePaymentIsoDate, 'Use a real YYYY-MM-DD payment date'),
}).strict();
const saveSchema = requestSchema.extend({
  expectedSnapshot: z.string().regex(/^[a-f0-9]{32}$/),
  confirmed: z.literal(true),
}).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

function errorResponse(error: unknown) {
  if (error instanceof ClientError || error instanceof NotFoundError || error instanceof MortgageDateCorrectionConflictError) {
    return json({ error: error.message }, error.status);
  }
  return json({ error: 'The payment date could not be verified or saved. No successful correction has been confirmed.' }, 503);
}

/** Read-only evidence for a possible old parser issue. This never changes a payment. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const propertyId = idSchema.safeParse((await params).id);
  const input = requestSchema.safeParse({
    mortgageId: request.nextUrl.searchParams.get('mortgageId'),
    journalId: request.nextUrl.searchParams.get('journalId'),
    correctDate: request.nextUrl.searchParams.get('correctDate'),
  });
  if (!propertyId.success || !input.success) return json({ error: 'Supply valid property, mortgage and payment IDs and a real proposed date.' }, 400);
  try {
    return json(await previewMortgagePaymentDateCorrection({ ...input.data, propertyId: propertyId.data }));
  } catch (error) { return errorResponse(error); }
}

/** Save only after the user confirms the exact preview and statement date. */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const propertyId = idSchema.safeParse((await params).id);
  const input = saveSchema.safeParse(await request.json().catch(() => null));
  if (!propertyId.success || !input.success) return json({ error: 'Review the current payment and explicitly confirm its statement date before saving.' }, 400);
  try {
    return json(await correctMortgagePaymentDate({
      mortgageId: input.data.mortgageId, journalId: input.data.journalId,
      correctDate: input.data.correctDate, expectedSnapshot: input.data.expectedSnapshot,
      propertyId: propertyId.data,
    }));
  } catch (error) { return errorResponse(error); }
}
