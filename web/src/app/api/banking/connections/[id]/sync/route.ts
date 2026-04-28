import { NextResponse } from 'next/server';
import { GoCardlessApiError, GoCardlessAuthError, GoCardlessRateLimitError } from '@/lib/banking/gocardless';
import { bankingRepo } from '@/lib/banking/repo';
import { syncConnection, reconcileTransfersForRun } from '@/lib/banking/sync';

/**
 * POST /api/banking/connections/[id]/sync
 *
 * Manual sync trigger. The same engine runs from the daily cron in
 * PR C. Pulls fresh transactions for every linked provider_account
 * since last_synced_at (or cutover_date on first run), dedups via
 * provider_txn_id, writes to journal_entries.
 *
 * Returns the resulting sync_runs row so the UI can show what
 * happened. Errors are mapped to user-actionable HTTP statuses
 * (401 -> 503 with reauth prompt, 429 -> 429 with retry-after).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  let runId: number | null = null;
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const conn = await bankingRepo.getConnection(connectionId);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });
    if (conn.status !== 'active' && conn.status !== 'expiring') {
      return NextResponse.json(
        { error: `Connection is ${conn.status}; reconnect required before sync.` },
        { status: 409 },
      );
    }
    const linked = await bankingRepo.listProviderAccounts(connectionId);
    if (linked.length === 0) {
      return NextResponse.json(
        { error: 'No accounts mapped yet. Map accounts first via /settings/connections/[id]/map.' },
        { status: 409 },
      );
    }

    runId = await bankingRepo.startSyncRun(connectionId);
    const outcome = await syncConnection(connectionId, runId);
    await bankingRepo.finishSyncRun(runId, {
      status: 'success',
      txnsAdded: outcome.txnsAdded,
      txnsUpdated: outcome.txnsUpdated,
    });
    await bankingRepo.markSynced(connectionId);

    // Reconcile transfers right after the sync. Scope to journals
    // touched by this run plus their date neighbours so we don't
    // re-scan the whole history on every "Sync now" click. A
    // reconciler error is non-fatal (the sync itself succeeded;
    // surface the count anyway).
    let transfersMerged = 0;
    try {
      transfersMerged = await reconcileTransfersForRun(runId, 3);
    } catch (e) {
      console.error('reconcileTransfersForRun failed after manual sync:', e);
    }

    return NextResponse.json({ syncRunId: runId, transfersMerged, ...outcome });
  } catch (err) {
    if (runId !== null) {
      const msg = err instanceof Error ? err.message : 'unknown error';
      await bankingRepo.finishSyncRun(runId, { status: 'error', txnsAdded: 0, txnsUpdated: 0, errorMessage: msg }).catch(() => {});
    }

    if (err instanceof GoCardlessAuthError) {
      console.error('GoCardless auth failure during sync:', err.message);
      return NextResponse.json(
        { error: 'GoCardless credentials missing or invalid (check env). If this connection just expired, reconnect via /settings/connections.' },
        { status: 503 },
      );
    }
    if (err instanceof GoCardlessRateLimitError) {
      return NextResponse.json(
        { error: `Rate-limited by GoCardless. Retry after ${err.retryAfterSeconds}s.` },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSeconds) } },
      );
    }
    if (err instanceof GoCardlessApiError) {
      console.error('GoCardless API error during sync:', { upstreamStatus: err.status, message: err.message });
      return NextResponse.json(
        { error: `Sync failed (upstream status ${err.status})` },
        { status: 502 },
      );
    }
    console.error('Sync failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
