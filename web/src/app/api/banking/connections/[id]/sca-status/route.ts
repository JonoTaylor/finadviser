import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { bankingRepo } from '@/lib/banking/repo';
import {
  checkMonzoAuth,
  decodeTokenBundle,
  MonzoApiError,
  MonzoAuthError,
} from '@/lib/banking/monzo';

/**
 * GET /api/banking/connections/[id]/sca-status
 *
 * Polled by the SCA-pending page after a Monzo OAuth callback.
 * Returns:
 *   { status: 'pending' }  - SCA not yet approved (Monzo /ping/whoami
 *                            returns 403). Frontend keeps polling.
 *   { status: 'active' }   - SCA approved. Frontend redirects to the
 *                            mapping wizard.
 *   { status: 'error', message } - hard failure (token invalid /
 *                            expired). Frontend surfaces the message
 *                            and offers a Reconnect.
 *
 * Side effect: when SCA resolves to active, this endpoint also
 * flips the connection's status to 'active' so the connections list
 * UI updates correctly the next time it loads.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const connectionId = parseInt(id, 10);
    if (Number.isNaN(connectionId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }

    const conn = await bankingRepo.getConnection(connectionId);
    if (!conn) return NextResponse.json({ error: 'Connection not found' }, { status: 404 });

    // Read the encrypted token bundle. listConnections doesn't
    // include encrypted_secret (it's BYTEA), so fetch directly here.
    // decodeTokenBundle handles the multiple shapes that Neon HTTP
    // returns BYTEA in (Buffer / Uint8Array / hex-prefixed string).
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT encrypted_secret FROM connections WHERE id = ${connectionId} LIMIT 1
    `);
    const raw = rows.rows[0]?.encrypted_secret;
    if (raw === null || raw === undefined) {
      return NextResponse.json({ status: 'error', message: 'No tokens recorded for this connection. Reconnect.' }, { status: 200 });
    }
    const bundle = decodeTokenBundle(raw as Buffer | Uint8Array | string);

    const ok = await checkMonzoAuth(bundle.accessToken);
    if (!ok) {
      return NextResponse.json({ status: 'pending' });
    }

    // SCA resolved: flip the row to 'active' if it isn't already.
    if (conn.status !== 'active') {
      await bankingRepo.setConnectionStatus(connectionId, 'active', { lastError: null });
    }
    return NextResponse.json({ status: 'active' });
  } catch (err) {
    if (err instanceof MonzoAuthError) {
      return NextResponse.json(
        { status: 'error', message: 'Monzo refused the saved token. Reconnect via /settings/connections.' },
        { status: 200 },
      );
    }
    if (err instanceof MonzoApiError) {
      console.error('Monzo SCA poll API error:', { upstreamStatus: err.status, message: err.message });
      return NextResponse.json(
        { status: 'error', message: `Monzo ${err.status} during SCA check` },
        { status: 200 },
      );
    }
    // Decode-side errors (decryption, JSON parse, schema validation)
    // are user-actionable - the message itself tells them what to do
    // (e.g. "OAuth client must be Confidential"). Surface as a 200
    // with the status='error' shape so the SCA-pending page can
    // render the message verbatim instead of showing a generic
    // "something went wrong" through the 500 path.
    if (err instanceof Error && err.message.startsWith('Decrypted Monzo token bundle')) {
      return NextResponse.json(
        { status: 'error', message: err.message },
        { status: 200 },
      );
    }
    console.error('SCA poll failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
