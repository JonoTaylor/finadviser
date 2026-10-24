import { NextResponse } from 'next/server';
import { z } from 'zod';
import { payeeDisableSchema, payeeMemorySchema } from '@/lib/categorization/payees/schema';
import { disablePayeeMemory, InvalidPayeeMemoryError, PayeeMemoryConflictError } from '@/lib/categorization/payees/service';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = z.uuid().safeParse((await params).id);
  const parsed = payeeDisableSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !parsed.success) return json({ error: 'Choose the current saved payment meaning before disabling it.' }, 400);
  try {
    const memory = await disablePayeeMemory(id.data, parsed.data.expectedRevision);
    return memory ? json({ memory: payeeMemorySchema.parse(memory) }) : json({ error: 'This saved payment meaning was not found.' }, 404);
  } catch (error) {
    if (error instanceof PayeeMemoryConflictError) return json({ error: error.message }, 409);
    if (error instanceof InvalidPayeeMemoryError) return json({ error: error.message }, 422);
    return json({ error: 'Disabling this payment meaning could not be confirmed. Reload its current status before trying again.' }, 503);
  }
}
