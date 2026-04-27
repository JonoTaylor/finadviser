import { NextResponse } from 'next/server';
import { runDailySync } from '@/lib/banking/cron-sync';

/**
 * GET /api/cron/sync-connections
 *
 * Daily sync trigger called from Vercel Cron (configured in
 * vercel.json). Auth via the standard `Authorization: Bearer
 * ${CRON_SECRET}` header that Vercel Cron adds to every scheduled
 * request when the env var is set. The route is whitelisted in
 * middleware.ts so the auth-cookie check doesn't block it.
 *
 * Idempotent: each run starts a new sync_runs row per connection
 * and the journal-side dedup (provider_txn_id partial UNIQUE +
 * the ingest_bank_transaction function) keeps re-runs harmless.
 *
 * Cron timeout: most syncs land in single-digit seconds, but we
 * give ourselves 60s headroom for a four-bank cold-start path.
 */
export const maxDuration = 60;
export const runtime = 'nodejs';

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET ?? ''}`;
  if (!process.env.CRON_SECRET) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured in env' },
      { status: 503 },
    );
  }
  if (authHeader !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const summary = await runDailySync();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    // Cron failures should be visible in Vercel logs but not surfaced
    // raw to the caller. The orchestrator already keeps per-connection
    // errors in summary.errors; this catch covers the unusual case
    // where the orchestrator itself throws (e.g. listConnections fails).
    console.error('Daily cron failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
