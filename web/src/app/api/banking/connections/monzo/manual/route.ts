import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  listMonzoAccounts,
  encodeTokenBundle,
  generateMonzoStateNonce,
  MonzoApiError,
  MonzoAuthError,
  MonzoSCAPendingError,
} from '@/lib/banking/monzo';
import { bankingRepo } from '@/lib/banking/repo';

/**
 * POST /api/banking/connections/monzo/manual
 *
 * Body: { accessToken: string, expiresIn?: number, ownerId?: number }
 *
 * Manual-token connect path for users whose Monzo OAuth client is
 * not Confidential (the default for new developer-portal accounts;
 * confidential client creation requires explicit Monzo approval).
 *
 * The user pastes an access token they minted at
 * https://developers.monzo.com/api/playground - we validate it by
 * calling /accounts (confirms the token works AND that SCA is
 * approved), then store it without a refresh token.
 *
 * Trade-off: tokens last 6 hours and there's no refresh capability.
 * When the token expires the cron flips the connection to 'expired'
 * and the user has to paste a fresh playground token. For a daily-
 * sync use case that means re-pasting at least once a day; the
 * canonical fix is to get a Confidential client via
 * developer-support@monzo.com.
 *
 * Idempotent on the Monzo provider: any prior non-active Monzo
 * connection is cleared before a new one is created.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const accessToken = body.accessToken as string | undefined;
    const expiresInRaw = body.expiresIn as number | undefined;
    const ownerId = body.ownerId as number | null | undefined;

    if (typeof accessToken !== 'string' || accessToken.length < 20) {
      return NextResponse.json(
        { error: 'accessToken is required (paste from https://developers.monzo.com/api/playground)' },
        { status: 400 },
      );
    }
    // Default expiry: 5h55m. Playground tokens are nominally 6 hours;
    // the safety margin keeps us comfortably ahead of the boundary.
    const expiresInSeconds = typeof expiresInRaw === 'number' && Number.isFinite(expiresInRaw) && expiresInRaw > 0
      ? Math.min(expiresInRaw, 21600)
      : 21300;

    // Validate the token by calling /accounts. This confirms (a) the
    // token is well-formed and active, (b) SCA is already approved
    // for this token (the playground requires you to tap Authorise
    // before issuing it).
    let accounts;
    try {
      accounts = await listMonzoAccounts(accessToken);
    } catch (err) {
      if (err instanceof MonzoSCAPendingError) {
        return NextResponse.json(
          { error: 'This token is not yet authorised. Open https://developers.monzo.com/api/playground, tap Authorise on the access token, then retry.' },
          { status: 400 },
        );
      }
      if (err instanceof MonzoAuthError) {
        return NextResponse.json(
          { error: 'Monzo rejected the token. Check it was copied correctly from the playground (no leading or trailing whitespace).' },
          { status: 400 },
        );
      }
      if (err instanceof MonzoApiError) {
        return NextResponse.json(
          { error: `Monzo ${err.status} when validating token` },
          { status: 502 },
        );
      }
      throw err;
    }
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: 'Token validated but no Monzo accounts visible. Make sure the playground token has read_accounts + read_transactions scope.' },
        { status: 400 },
      );
    }

    const provider = await bankingRepo.getProviderBySlug('monzo');
    if (!provider) {
      return NextResponse.json({ error: 'Monzo provider is not seeded; re-run migration' }, { status: 500 });
    }

    // Clear out any prior non-active rows for this provider so the
    // new manual-token row is the canonical Monzo connection.
    await bankingRepo.deleteStaleConnectionsForProvider(provider.id);

    const accessExpiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    const bundle = encodeTokenBundle({
      accessToken,
      // No refreshToken: this is the playground/non-confidential
      // path. dispatch.getMonzoAccessToken handles a missing-refresh
      // bundle by marking the connection 'expired' on access-token
      // expiry rather than attempting a refresh that can't succeed.
      accessExpiresAtMs: accessExpiresAt.getTime(),
      webhookToken: generateMonzoStateNonce(),
    });
    const aggregatorRef = `manual-${generateMonzoStateNonce(16)}`;

    // Create as pending then immediately flip to active. The
    // playground token is already SCA-approved at issue time, so
    // there's no SCA-wait state for this path.
    const conn = await bankingRepo.createPendingConnection({
      providerId: provider.id,
      ownerId: typeof ownerId === 'number' ? ownerId : null,
      aggregatorRef,
      consentExpiresAt: accessExpiresAt,
      institutionId: 'monzo',
      institutionName: 'Monzo',
    });

    // Persist the encrypted token bundle + denormalised expiry, and
    // flip status to active in one shot via raw SQL so the BYTEA
    // round-trip uses the same path the OAuth callback does.
    const db = getDb();
    await db.execute(sql`
      UPDATE connections
         SET encrypted_secret = ${bundle},
             monzo_access_expires_at = ${accessExpiresAt},
             status = 'active',
             last_error = NULL,
             updated_at = now()
       WHERE id = ${conn.id}
    `);

    return NextResponse.json({
      connectionId: conn.id,
      accountsAvailable: accounts.length,
      expiresAt: accessExpiresAt.toISOString(),
    });
  } catch (err) {
    console.error('Monzo manual-token connect failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
