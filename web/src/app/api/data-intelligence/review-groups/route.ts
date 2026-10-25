import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { decideReviewGroup, loadReviewGroups, reviewGroupDecisionSchema } from '@/lib/categorization/review-groups';
import { CategorizationConflictError, InvalidCategorizationError } from '@/lib/categorization/review';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const querySchema = z.object({ limit: z.coerce.number().int().min(1).max(15).default(15), afterKey: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict();

export async function GET(request: NextRequest) {
  const query = querySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams));
  if (!query.success) return json({ error: 'Choose a valid group cursor and up to 15 groups.' }, 400);
  try { return json(await loadReviewGroups(query.data.limit, query.data.afterKey)); }
  catch { return json({ error: 'Your grouped payment review could not be loaded. No decisions have been assumed.' }, 503); }
}

export async function POST(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); } catch { return json({ error: 'Supply a valid grouped payment decision.' }, 400); }
  const parsed = reviewGroupDecisionSchema.safeParse(body);
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Supply a valid grouped payment decision.' }, 400);
  try { return json(await decideReviewGroup(parsed.data)); }
  catch (error) {
    if (error instanceof CategorizationConflictError) return json({ error: 'One or more payments or suggestions changed. No group decision was applied. Reload before confirming again.' }, 409);
    if (error instanceof InvalidCategorizationError) return json({ error: error.message }, 422);
    return json({ error: 'The group decision could not be confirmed. Reload the current records before retrying.' }, 503);
  }
}
