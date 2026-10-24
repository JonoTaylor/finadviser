import { after, NextResponse } from 'next/server';
import { authenticatedCategorizationJobId } from '@/lib/categorization/jobs/worker-auth';
import { dispatchCategorizationJob } from '@/lib/categorization/jobs/dispatch';
import { getCategorizationJob, runCategorizationJob } from '@/lib/categorization/jobs/service';
import { maybeEvaluateCategorizationModels } from '@/lib/ai/categorization-models/service';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };

async function preflightJob(jobId: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      getCategorizationJob(jobId),
      new Promise<null>(resolve => { timeout = setTimeout(() => resolve(null), 2_000); }),
    ]);
  } finally { clearTimeout(timeout); }
}

export async function POST(request: Request) {
  const deadline = Date.now() + 110_000;
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: 'The background worker is not configured.' }, { status: 503, headers });
  const jobId = authenticatedCategorizationJobId(request, process.env.SESSION_SECRET);
  if (!jobId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  after(async () => {
    try {
      const job = await preflightJob(jobId);
      if (job && (job.status === 'queued' || job.status === 'running')
        && !job.cancelRequested && !job.pauseRequested && job.scopeAvailable !== null && job.scopeAvailable > 0
        && deadline - Date.now() > 60_000) {
        // Synthetic cases only. One leased comparison is shared across hops;
        // it cannot consume the categoriser's own per-batch time budget.
        await maybeEvaluateCategorizationModels({ budgetMs: 29_000 });
      }
      const budgetMs = Math.min(75_000, deadline - Date.now() - 10_000);
      if (budgetMs < 29_000) return;
      const result = await runCategorizationJob(jobId, { budgetMs });
      if (!result.shouldContinue || !result.job || result.job.status !== 'queued') return;
      const delay = Number.isFinite(result.delayMs) ? Math.max(0, Math.min(result.delayMs, 10_000)) : 0;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      await dispatchCategorizationJob(jobId);
    } catch {
      // The durable lease expires for recovery. Never replay an unverified pass
      // inside the same function or print financial/provider/database payloads.
      console.warn('[categorization-jobs] worker slice unavailable');
    }
  });
  return NextResponse.json({ accepted: true }, { status: 202, headers });
}
