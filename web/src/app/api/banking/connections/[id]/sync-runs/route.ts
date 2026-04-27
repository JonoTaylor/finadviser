import { NextResponse } from 'next/server';
import { bankingRepo } from '@/lib/banking/repo';

/**
 * GET /api/banking/connections/[id]/sync-runs
 *
 * Returns the last N sync runs for a connection, newest first. Used
 * by /settings/connections/[id]/sync-runs for diagnostics; reading
 * straight from sync_runs without touching the aggregator.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const conn = await bankingRepo.getConnection(connectionId);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const runs = await bankingRepo.listRecentSyncRuns(connectionId, 50);
    return NextResponse.json({ connection: conn, runs });
  } catch (err) {
    console.error('Get sync runs failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
