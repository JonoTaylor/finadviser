import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  CategorizationConflictError, InvalidCategorizationError,
  decideReview, loadReviewQueue, reviewDecisionSchema,
} from '@/lib/categorization/review';

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(25),
  afterId: z.coerce.number().int().min(0).default(0),
});
const HEADERS = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: HEADERS });

export async function GET(request: NextRequest) {
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return json({ error: 'Use a valid review cursor and a page size between one and 50.' }, 400);
  try { return json(await loadReviewQueue(query.data.limit, query.data.afterId)); }
  catch { return json({ error: 'Your review queue could not be loaded. Please retry when your records are available.' }, 503); }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return json({ error: 'Supply a valid review decision.' }, 400); }
  const input = reviewDecisionSchema.safeParse(body);
  if (!input.success) return json({ error: input.error.issues[0]?.message ?? 'Supply a valid review decision.' }, 400);
  try { return json(await decideReview(input.data)); }
  catch (error) {
    if (error instanceof CategorizationConflictError) return json({ error: error.message }, 409);
    if (error instanceof InvalidCategorizationError) return json({ error: error.message }, 422);
    return json({ error: 'The review could not be confirmed. Your choice is still available; reload the latest records before retrying.' }, 503);
  }
}
