import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getCategorizationJob, startCategorizationJob } from '@/lib/categorization/jobs/service';
import { categorizationJobResponse } from '@/lib/categorization/jobs/server-response';

export const maxDuration = 120;
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
const startSchema = z.object({}).strict();

/** Recover an already-authorised queued job, without resuming a paused/cancelled one. */
export async function GET() {
  try {
    return NextResponse.json(categorizationJobResponse(await getCategorizationJob()), { headers });
  } catch {
    return NextResponse.json({ error: 'Processing progress could not be loaded. Saved work has not been treated as complete.' }, { status: 503, headers });
  }
}

export async function POST(request: Request) {
  const body = await request.text();
  if (body.length > 2000) return NextResponse.json({ error: 'The processing request is too large.' }, { status: 400, headers });
  let input: unknown;
  try { input = body.trim() ? JSON.parse(body) : {}; }
  catch { return NextResponse.json({ error: 'Provide valid JSON processing options.' }, { status: 400, headers }); }
  if (!startSchema.safeParse(input).success) return NextResponse.json({ error: 'Start processing without additional options.' }, { status: 400, headers });
  try {
    // The core atomically deduplicates active jobs and preserves an existing
    // user/provider pause. A repeated click does not restart uncertain work.
    const job = await startCategorizationJob();
    return NextResponse.json(categorizationJobResponse(job, true), { status: 202, headers });
  } catch {
    return NextResponse.json({ error: 'The processing job could not be started or confirmed. Check its saved status before retrying.' }, { status: 503, headers });
  }
}
