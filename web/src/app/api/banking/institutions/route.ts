import { NextResponse } from 'next/server';
import { gocardless, GoCardlessApiError, GoCardlessAuthError } from '@/lib/banking/gocardless';

/**
 * GET /api/banking/institutions?country=gb
 *
 * Smoke-test + first-connect endpoint. Lists every institution the
 * configured aggregator (GoCardless BAD) supports in the given
 * country, plus a `coverage` summary that picks out the four banks
 * we care about (Monzo, Barclays, Amex UK, Yonder).
 *
 * Used in PR A to verify aggregator coverage before any UI work
 * commits to GoCardless. If `coverage` reports any of the four as
 * `missing`, the call is informative rather than fatal — we just
 * fall back to TrueLayer for that provider.
 *
 * Responses:
 *   200 { coverage, institutions }
 *   500 { error } when GoCardless is unreachable / auth fails;
 *       leaves the user-facing UI to surface a "coverage check
 *       failed" state rather than a blank page.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const country = (url.searchParams.get('country') ?? 'gb').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) {
    return NextResponse.json({ error: 'country must be ISO 3166-1 alpha-2' }, { status: 400 });
  }

  try {
    const institutions = await gocardless.listInstitutions(country);
    const targets: Array<'monzo' | 'barclays' | 'amex_uk' | 'yonder'> = ['monzo', 'barclays', 'amex_uk', 'yonder'];
    const coverage = Object.fromEntries(
      targets.map((t) => {
        const match = institutions.find((i) => i.knownProvider === t) ?? null;
        return [t, match
          ? { status: 'available' as const, institutionId: match.id, name: match.name, consentMaxDays: match.consentMaxDays, transactionsMaxHistoricalDays: match.transactionsMaxHistoricalDays }
          : { status: 'missing' as const }];
      }),
    );
    return NextResponse.json({ coverage, institutions });
  } catch (err) {
    if (err instanceof GoCardlessAuthError) {
      return NextResponse.json(
        { error: 'GoCardless credentials missing or invalid (check GOCARDLESS_BAD_SECRET_ID / SECRET_KEY)' },
        { status: 500 },
      );
    }
    if (err instanceof GoCardlessApiError) {
      // err.message stringifies the upstream body, which may carry
      // unexpected detail. Log it for diagnosis and return a stable
      // user-facing message + the upstream status so the coverage
      // card can still render an actionable "Y502 / 503" hint.
      console.error('GoCardless institutions API error:', {
        upstreamStatus: err.status,
        message: err.message,
      });
      return NextResponse.json(
        { error: `Failed to fetch institutions from GoCardless (upstream status ${err.status})` },
        { status: 502 },
      );
    }
    // Catch-all: log the real error server-side (Vercel logs only,
    // never reachable by an end user) and return a generic message
    // so internal stack traces / third-party error bodies don't
    // leak in the response.
    console.error('Institutions API error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
