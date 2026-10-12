import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { journalRepo } from '@/lib/repos';
import { CategorizationConflictError, InvalidCategorizationError, confirmedCategorize, getCategorizationRecords } from '@/lib/categorization/review';

const journalIdSchema = z.coerce.number().int().positive().max(2147483647);
const categoryPatchSchema = z.object({
  categoryId: z.number().int().positive().max(2147483647),
  createRule: z.boolean().default(false),
  // Kept for existing clients; learning uses the actual saved transaction.
  description: z.string().optional(),
  expectedSnapshot: z.string().regex(/^[a-f0-9]{32}$/).optional(),
}).strict();
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const journalId = journalIdSchema.safeParse(id);
    if (!journalId.success) return json({ error: 'Use a valid transaction ID.' }, 400);
    const entry = await journalRepo.getEntry(journalId.data);
    if (!entry) return json({ error: 'Not found' }, 404);
    const [bookEntries, records] = await Promise.all([journalRepo.getBookEntries(journalId.data), getCategorizationRecords([journalId.data])]);
    return json({ ...entry, bookEntries, snapshot: records[0]?.snapshot ?? null });
  } catch {
    return json({ error: 'Failed to fetch entry' }, 500);
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const journalId = journalIdSchema.safeParse(id);
  if (!journalId.success) return json({ error: 'Use a valid transaction ID.' }, 400);
  let rawBody: unknown;
  try { rawBody = await request.json(); }
  catch { return json({ error: 'Supply a valid category choice.' }, 400); }
  const body = categoryPatchSchema.safeParse(rawBody);
  if (!body.success) return json({ error: 'Choose a valid category and current transaction details.' }, 400);
  try {
    const [record] = await getCategorizationRecords([journalId.data]);
    if (!record) return json({ error: 'Transaction not found.' }, 404);
    const result = await confirmedCategorize({
      journalId: journalId.data, categoryId: body.data.categoryId,
      snapshot: body.data.expectedSnapshot ?? record.snapshot,
      remember: body.data.createRule,
    });
    return json({ success: true, ...result });
  } catch (error) {
    if (error instanceof CategorizationConflictError) return json({ error: error.message }, 409);
    if (error instanceof InvalidCategorizationError) return json({ error: error.message }, 422);
    return json({ error: 'The category save could not be confirmed. Reload the latest transaction details before retrying.' }, 503);
  }
}
