import { NextResponse } from 'next/server';
import { z } from 'zod';
import { WorkspaceConflictError } from '@/lib/finance-workspace/store';
import { evaluateCategorizationModels, getCategorizationModelsSnapshot, ModelEvaluationInputError } from '@/lib/ai/categorization-models/service';
import { modelIdSchema } from '@/lib/ai/categorization-models/types';

export const maxDuration = 60;
const headers = { 'Cache-Control': 'private, no-store' };
const inputSchema = z.object({
  expectedRevision: z.number().int().nonnegative().max(1_000_000_000),
  modelIds: z.array(modelIdSchema).min(1).max(3).refine(ids => new Set(ids).size === ids.length).optional(),
  applyRecommendation: z.boolean().default(true),
}).strict();

export async function GET() {
  try { return NextResponse.json(await getCategorizationModelsSnapshot(), { headers }); }
  catch { return NextResponse.json({ error: 'Categorisation model settings could not be loaded.' }, { status: 503, headers }); }
}

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: 'Reload the saved settings and select up to three distinct Gateway models.' }, { status: 400, headers });
  try {
    const outcome = await evaluateCategorizationModels({ ...input.data, force: true, signal: request.signal });
    if (outcome.status === 'running') return NextResponse.json({ error: 'A comparison is already running. Reload its saved status.' }, { status: 409, headers });
    // A previous saved report cannot acknowledge this attempt. A timed-out
    // claim or save may still settle later; observe its state, never replay it.
    if (!outcome.report) return NextResponse.json({ error: 'The comparison could not be confirmed. Check its saved status before retrying.' }, { status: 503, headers });
    return NextResponse.json(await getCategorizationModelsSnapshot(), { headers });
  } catch (error) {
    if (error instanceof WorkspaceConflictError) return NextResponse.json({ error: 'These settings changed. Reload before starting another comparison.' }, { status: 409, headers });
    if (error instanceof ModelEvaluationInputError) return NextResponse.json({ error: error.message }, { status: 400, headers });
    return NextResponse.json({ error: 'The comparison could not be confirmed. Check its saved status before retrying.' }, { status: 503, headers });
  }
}
