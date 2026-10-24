import { NextResponse } from 'next/server';
import { z } from 'zod';
import {
  cancelCategorizationJob, getCategorizationJob, pauseCategorizationJob, resumeCategorizationJob,
} from '@/lib/categorization/jobs/service';
import { categorizationJobResponse } from '@/lib/categorization/jobs/server-response';

export const maxDuration = 120;
export const runtime = 'nodejs';
const headers = { 'Cache-Control': 'private, no-store' };
type Context = { params: Promise<{ id: string }> };
const idSchema = z.uuid();
const controlSchema = z.object({ action: z.enum(['pause', 'resume', 'cancel']) }).strict();

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Use a valid processing job ID.' }, { status: 400, headers });
  try {
    const job = await getCategorizationJob(id);
    if (!job) return NextResponse.json({ error: 'This processing job was not found.' }, { status: 404, headers });
    return NextResponse.json(categorizationJobResponse(job), { headers });
  } catch {
    return NextResponse.json({ error: 'Processing progress could not be loaded.' }, { status: 503, headers });
  }
}

export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return NextResponse.json({ error: 'Use a valid processing job ID.' }, { status: 400, headers });
  const body = await request.text();
  if (body.length > 2000) return NextResponse.json({ error: 'The processing request is too large.' }, { status: 400, headers });
  let input: unknown;
  try { input = JSON.parse(body); }
  catch { return NextResponse.json({ error: 'Provide a processing action.' }, { status: 400, headers }); }
  const parsed = controlSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ error: 'Choose pause, resume or cancel.' }, { status: 400, headers });
  try {
    const action = parsed.data.action;
    const job = action === 'pause' ? await pauseCategorizationJob(id)
      : action === 'resume' ? await resumeCategorizationJob(id) : await cancelCategorizationJob(id);
    if (!job) return NextResponse.json({ error: 'This processing job was not found.' }, { status: 404, headers });
    return NextResponse.json(categorizationJobResponse(job, action === 'resume'), { headers });
  } catch {
    return NextResponse.json({ error: 'The processing action could not be confirmed. Reload the saved status before trying it again.' }, { status: 503, headers });
  }
}
