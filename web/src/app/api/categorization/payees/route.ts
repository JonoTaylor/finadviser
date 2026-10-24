import { NextResponse } from 'next/server';
import { z } from 'zod';
import { payeeMemorySchema, payeeSaveSchema } from '@/lib/categorization/payees/schema';
import { InvalidPayeeMemoryError, PayeeMemoryConflictError, listPayeeMemories, saveConfirmedPayee } from '@/lib/categorization/payees/service';

export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function GET() {
  try { return json({ memories: z.array(payeeMemorySchema).parse(await listPayeeMemories()) }); }
  catch { return json({ error: 'Saved payment meanings could not be loaded. Their status remains unknown.' }, 503); }
}

export async function POST(request: Request) {
  const parsed = payeeSaveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: parsed.error.issues[0]?.message ?? 'Confirm a category, payee and current transaction before saving.' }, 400);
  try {
    const result = await saveConfirmedPayee(parsed.data);
    return json({ ...result, memory: payeeMemorySchema.parse(result.memory) });
  }
  catch (error) {
    if (error instanceof PayeeMemoryConflictError) return json({ error: error.message }, 409);
    if (error instanceof InvalidPayeeMemoryError) return json({ error: error.message }, 422);
    return json({ error: 'The payment meaning or category save could not be confirmed. Reload saved payment meanings and the current transaction before trying again.' }, 503);
  }
}
