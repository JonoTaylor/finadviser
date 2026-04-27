import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { bankingRepo } from '@/lib/banking/repo';
import {
  exchangeMonzoCode,
  encodeTokenBundle,
  generateMonzoStateNonce,
  MonzoApiError,
} from '@/lib/banking/monzo';

/**
 * GET /api/banking/connections/monzo/callback?code=X&state=Y
 *
 * Post-OAuth landing for the Monzo direct flow. The `state` we
 * passed in the auth URL (and pinned on the connection row's
 * `aggregator_ref`) is echoed back. Steps:
 *
 *  1. Look up the pending connection by state (anti-CSRF + lookup).
 *  2. Exchange the auth code for access + refresh tokens.
 *  3. Encrypt and persist the token bundle on
 *     `connections.encrypted_secret` (libsodium AES-256-GCM via
 *     `lib/banking/encryption.ts`). Also record
 *     `monzo_access_expires_at` for the cron's proactive-refresh
 *     query.
 *  4. Mark the connection 'pending' (still — SCA approval is the
 *     next step), then redirect to the SCA-pending page which
 *     polls until the user taps Allow in the Monzo app.
 *
 * The connection only flips to 'active' after SCA confirms via
 * /api/banking/connections/[id]/sca-status.
 *
 * Errors redirect back to /settings/connections with a query-string
 * error message rather than throwing a 500 — the user is bouncing
 * back from a third-party site and a generic browser error is
 * worse UX than a labelled snackbar.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const errorParam = url.searchParams.get('error');

  if (errorParam) {
    return redirectWithError(url.origin, `Monzo returned an error: ${errorParam}`);
  }
  if (!code || !state) {
    return redirectWithError(url.origin, 'Monzo callback missing code or state');
  }

  // Look up the connection by state. aggregator_ref is UNIQUE so this
  // resolves a single row or none.
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT id FROM connections WHERE aggregator_ref = ${state} LIMIT 1
  `);
  if (rows.rows.length === 0) {
    // Either the state is forged, or the placeholder row was already
    // cleaned up. Either way: don't trust this callback.
    return redirectWithError(url.origin, 'Monzo state nonce did not match any pending connection');
  }
  const connectionId = rows.rows[0].id as number;

  try {
    const redirectUri = `${url.origin}/api/banking/connections/monzo/callback`;
    const tokens = await exchangeMonzoCode({ code, redirectUri });

    const webhookToken = generateMonzoStateNonce();
    const bundle = encodeTokenBundle({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      accessExpiresAtMs: tokens.accessExpiresAtMs,
      webhookToken,
    });

    // Persist tokens + expiry. Status stays 'pending' until SCA
    // resolves; the SCA-pending page calls /sca-status which flips
    // it to active once /ping/whoami stops returning 403.
    await db.execute(sql`
      UPDATE connections
         SET encrypted_secret = ${bundle},
             monzo_access_expires_at = ${new Date(tokens.accessExpiresAtMs)},
             updated_at = now()
       WHERE id = ${connectionId}
    `);

    return NextResponse.redirect(`${url.origin}/settings/connections/${connectionId}/sca-pending`);
  } catch (err) {
    const msg = err instanceof MonzoApiError
      ? `Monzo ${err.status}`
      : err instanceof Error ? err.message : 'unknown error';
    console.error('Monzo callback failed:', err);
    await bankingRepo.setConnectionStatus(connectionId, 'error', { lastError: msg }).catch(() => {});
    return redirectWithError(url.origin, `Monzo OAuth failed: ${msg}`);
  }
}

function redirectWithError(origin: string, message: string) {
  return NextResponse.redirect(`${origin}/settings/connections?error=${encodeURIComponent(message)}`);
}
