import { NextResponse } from 'next/server';
import { z } from 'zod';
import { processCategorization } from '@/lib/categorization/service';

export const maxDuration = 60;
const headers = { 'Cache-Control': 'no-store' };
const optionsSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  deadlineMs: z.number().int().min(1).max(45000).optional(),
  modelTimeoutMs: z.number().int().min(1).max(30000).optional(),
  journalIds: z.array(z.number().int().positive()).max(10000).optional(),
}).strict();

export async function POST(request?: Request) {
  let options: z.infer<typeof optionsSchema> = {};
  if (request) {
    const body = await request.text();
    if (body.length > 100000) return NextResponse.json({ error: 'The processing request is too large.' }, { status: 400, headers });
    if (body.trim()) {
      try {
        const parsed = optionsSchema.safeParse(JSON.parse(body));
        if (!parsed.success) return NextResponse.json({ error: 'Use valid processing limits and journal IDs.' }, { status: 400, headers });
        options = parsed.data;
      } catch {
        return NextResponse.json({ error: 'Provide valid JSON processing options.' }, { status: 400, headers });
      }
    }
  }
  try {
    const result = await processCategorization({ ...options, source: 'manual' });
    return NextResponse.json(result, { headers });
  } catch {
    console.warn('[categorization] processing or persistence unavailable');
    return NextResponse.json({
      error: 'Transaction processing is unavailable. Existing records have been preserved; please try again.',
    }, { status: 503, headers });
  }
}
