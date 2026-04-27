import { NextResponse } from 'next/server';
import { gocardless, GoCardlessApiError, GoCardlessAuthError } from '@/lib/banking/gocardless';
import { bankingRepo } from '@/lib/banking/repo';
import type { ProviderSlug } from '@/lib/banking/aggregator';

/**
 * GET  /api/banking/connections           List all connections (joined with provider name).
 * POST /api/banking/connections           Initiate a new connect flow for a given provider.
 *                                         Body: { provider: 'monzo' | 'barclays' | 'amex_uk' | 'yonder', ownerId?: number }
 *                                         Returns: { connectionId, consentUrl } - frontend redirects user there.
 *
 * The post-consent redirect lands on /api/banking/connections/callback?ref=<connectionId>.
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

    // Discover the institution id from the aggregator's GB catalogue.
    // We classified it during the smoke test, so this is just a
    // re-lookup; cached briefly in the access-token round-trip.
    const institutions = await gocardless.listInstitutions('gb');
    const match = institutions.find(i => i.knownProvider === slug);
    if (!match) {
      return NextResponse.json(
        { error: `${provider.displayName} is not currently in the GoCardless UK catalogue. Fall back to TrueLayer for this provider.` },
        { status: 422 },
      );
    }

    // Build the redirect URI against this deployment's origin so
    // preview deploys callback to themselves rather than production.
    // The user must register each origin in the GoCardless dashboard
    // (or use a wildcard pattern there).
    const origin = new URL(req.url).origin;
    const redirectUri = `${origin}/api/banking/connections/callback`;

    // Create a placeholder connection up front so we have an id to
    // pass as `reference` to the aggregator. The status starts as
    // pending; the callback flips it to active. If the user
    // abandons the consent flow the row stays pending (visible in
    // the UI as "needs reconnect").
    //
    // We need the connection.id BEFORE calling createConsent because
    // GoCardless's `reference` is the only thing it echoes back to
    // us in the callback URL. Doing this in two steps means the
    // first DB write happens with a placeholder aggregator_ref;
    // patched after createConsent succeeds.
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
      // Patch the placeholder ref to the real requisition_id and
      // refresh consentExpiresAt with what the aggregator actually
      // returned (PR C will refresh again post-consent).
      const db = (await import('@/lib/db')).getDb();
      const { connections } = (await import('@/lib/db')).schema;
      const { eq } = await import('drizzle-orm');
      await db
        .update(connections)
        .set({
          aggregatorRef: consent.aggregatorRef,
          consentExpiresAt: consent.consentExpiresAt,
          updatedAt: new Date(),
        })
        .where(eq(connections.id, conn.id));

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
