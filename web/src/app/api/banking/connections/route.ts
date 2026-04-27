import { NextResponse } from 'next/server';
import { gocardless, GoCardlessApiError, GoCardlessAuthError } from '@/lib/banking/gocardless';
import { buildMonzoAuthUrl, generateMonzoStateNonce } from '@/lib/banking/monzo';
import { bankingRepo } from '@/lib/banking/repo';
import type { ProviderSlug } from '@/lib/banking/aggregator';

/**
 * GET  /api/banking/connections           List all connections (joined with provider name).
 * POST /api/banking/connections           Initiate a new connect flow for a given provider.
 *                                         Body: { provider: 'monzo' | 'barclays' | 'amex_uk' | 'yonder', ownerId?: number }
 *                                         Returns: { connectionId, consentUrl } - frontend redirects user there.
 *
 * Two paths depending on the provider's configured aggregator:
 *  - 'gocardless_bad' (Barclays, Amex UK, Yonder, etc): we ask
 *    GoCardless to broker the OAuth dance with the bank. Callback
 *    lands on /api/banking/connections/callback?ref=<connectionId>.
 *  - 'monzo_direct' (Monzo): we own the OAuth flow ourselves with
 *    Monzo's own API. Callback lands on
 *    /api/banking/connections/monzo/callback?code=X&state=Y.
 */

const VALID_PROVIDERS: ProviderSlug[] = ['monzo', 'barclays', 'amex_uk', 'yonder'];

export async function GET() {
  try {
    const connections = await bankingRepo.listConnections();
    return NextResponse.json({ connections });
  } catch (err) {
    console.error('List connections failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const slug = body.provider as string | undefined;
    const ownerId = body.ownerId as number | null | undefined;

    if (!slug || !VALID_PROVIDERS.includes(slug as ProviderSlug)) {
      return NextResponse.json(
        { error: `provider is required and must be one of ${VALID_PROVIDERS.join(', ')}` },
        { status: 400 },
      );
    }

    const provider = await bankingRepo.getProviderBySlug(slug as ProviderSlug);
    if (!provider) {
      return NextResponse.json({ error: `Provider ${slug} is not seeded; re-run migration` }, { status: 500 });
    }

    // Clear out any prior non-active rows for this provider before
    // creating a new pending one. Same dedup guard as before.
    await bankingRepo.deleteStaleConnectionsForProvider(provider.id);

    const origin = new URL(req.url).origin;

    // ── Monzo direct OAuth path ───────────────────────────────────
    if (provider.aggregator === 'monzo_direct') {
      const state = generateMonzoStateNonce();
      const redirectUri = `${origin}/api/banking/connections/monzo/callback`;
      // The Monzo `state` doubles as our connection lookup on
      // callback (CSRF protection + connection-id mapping in one
      // nonce). We pin it on the connection row so the callback
      // can find this row via aggregator_ref = state.
      const conn = await bankingRepo.createPendingConnection({
        providerId: provider.id,
        ownerId: typeof ownerId === 'number' ? ownerId : null,
        aggregatorRef: state,
        // Monzo doesn't have a hard 90-day cap (their tokens refresh
        // indefinitely), but we set a generous default so the
        // expiring/expired status logic in cron-sync still flags
        // stale connections eventually. Reset every reauth.
        consentExpiresAt: new Date(Date.now() + 365 * 86_400_000),
        institutionId: 'monzo',
        institutionName: 'Monzo',
      });
      const consentUrl = buildMonzoAuthUrl({ state, redirectUri });
      return NextResponse.json({ connectionId: conn.id, consentUrl });
    }

    // ── GoCardless brokered path (default for everything else) ──
    const institutions = await gocardless.listInstitutions('gb');
    const match = institutions.find(i => i.knownProvider === slug);
    if (!match) {
      return NextResponse.json(
        { error: `${provider.displayName} is not currently in the GoCardless UK catalogue. Fall back to TrueLayer for this provider.` },
        { status: 422 },
      );
    }

    const redirectUri = `${origin}/api/banking/connections/callback`;

    const placeholderRef = `pending-${crypto.randomUUID()}`;
    const conn = await bankingRepo.createPendingConnection({
      providerId: provider.id,
      ownerId: typeof ownerId === 'number' ? ownerId : null,
      aggregatorRef: placeholderRef,
      consentExpiresAt: new Date(Date.now() + 90 * 86_400_000),
      institutionId: match.id,
      institutionName: match.name,
    });

    try {
      const consent = await gocardless.createConsent({
        institutionId: match.id,
        redirectUri,
        reference: String(conn.id),
        maxHistoricalDays: match.transactionsMaxHistoricalDays,
      });
      await bankingRepo.updateConnectionAfterConsent(conn.id, {
        aggregatorRef: consent.aggregatorRef,
        consentExpiresAt: consent.consentExpiresAt,
      });
      return NextResponse.json({ connectionId: conn.id, consentUrl: consent.consentUrl });
    } catch (err) {
      // Roll back the placeholder row on failure so the user can
      // retry without a stale "pending" entry cluttering the list.
      await bankingRepo.deleteConnection(conn.id);
      throw err;
    }
  } catch (err) {
    if (err instanceof GoCardlessAuthError) {
      return NextResponse.json(
        { error: 'GoCardless credentials missing or invalid (check GOCARDLESS_BAD_SECRET_ID / SECRET_KEY)' },
        { status: 500 },
      );
    }
    if (err instanceof GoCardlessApiError) {
      console.error('GoCardless connect API error:', { upstreamStatus: err.status, message: err.message });
      return NextResponse.json(
        { error: `Failed to initiate consent (upstream status ${err.status})` },
        { status: 502 },
      );
    }
    console.error('Connect initiation failed:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
