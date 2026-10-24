import { after, NextResponse } from 'next/server';
import { authenticatedCategorizationJobId } from '@/lib/categorization/jobs/worker-auth';
import { dispatchCategorizationJob } from '@/lib/categorization/jobs/dispatch';
import { runCategorizationJob } from '@/lib/categorization/jobs/service';

export const runtime = 'nodejs';
export const maxDuration = 120;
const headers = { 'Cache-Control': 'private, no-store' };

export async function POST(request: Request) {
  if (!process.env.SESSION_SECRET) return NextResponse.json({ error: 'The background worker is not configured.' }, { status: 503, headers });
  const jobId = authenticatedCategorizationJobId(request, process.env.SESSION_SECRET);
  if (!jobId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers });
  after(async () => {
    try {
      const result = await runCategorizationJob(jobId, { budgetMs: 75_000 });
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
