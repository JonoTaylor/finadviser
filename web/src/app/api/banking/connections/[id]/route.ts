import { NextResponse } from 'next/server';
import { GoCardlessApiError } from '@/lib/banking/gocardless';
import { listAccountsForConnection } from '@/lib/banking/dispatch';
import { MonzoApiError, MonzoSCAPendingError } from '@/lib/banking/monzo';
import { bankingRepo } from '@/lib/banking/repo';

/**
 * GET    /api/banking/connections/[id]    Connection details + the aggregator-side accounts available
 *                                         for mapping (used by the mapping wizard).
 * DELETE /api/banking/connections/[id]    Disconnect: removes the row and cascades provider_accounts
 *                                         + sync_runs. Does NOT touch journal_entries previously
 *                                         ingested by this connection (those keep provider_txn_id and
 *                                         remain queryable but no longer sync).
 */

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const conn = await bankingRepo.getConnection(connectionId);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    const linked = await bankingRepo.listProviderAccounts(connectionId);

    // Pull the aggregator-side account list so the mapping wizard
    // can show every bank account on the consent. If we've already
    // fully mapped them all, this still works (the wizard uses the
    // intersection to detect "already mapped" rows).
    let aggregatorAccounts: Array<{ aggregatorAccountRef: string; iban: string | null; currency: string; ownerName: string | null; product: string | null }> = [];
    let aggregatorError: string | null = null;
    if (conn.status === 'active' || conn.status === 'expiring') {
      try {
        aggregatorAccounts = await listAccountsForConnection(conn);
      } catch (err) {
        if (err instanceof MonzoSCAPendingError) {
          aggregatorError = 'Monzo Strong Customer Authentication is still pending. Open the Monzo app and tap Allow.';
        } else if (err instanceof GoCardlessApiError) {
          aggregatorError = `GoCardless ${err.status}`;
        } else if (err instanceof MonzoApiError) {
          aggregatorError = `Monzo ${err.status}`;
        } else {
          aggregatorError = err instanceof Error ? err.message : 'unknown';
        }
      }
    }

    return NextResponse.json({
      connection: conn,
      linkedAccounts: linked,
      aggregatorAccounts,
      aggregatorError,
    });
  } catch (err) {
    console.error('Get connection failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 });

    const existing = await bankingRepo.getConnection(connectionId);
    if (!existing) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    await bankingRepo.deleteConnection(connectionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('Delete connection failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
