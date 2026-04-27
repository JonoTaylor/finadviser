import { NextResponse } from 'next/server';
import { gocardless, GoCardlessApiError } from '@/lib/banking/gocardless';
import { bankingRepo } from '@/lib/banking/repo';

/**
 * GET /api/banking/connections/callback?ref=<connectionId>
 *
 * Handler for the post-consent redirect from the bank. GoCardless
 * echoes back the `reference` we passed at requisition creation as
 * the `ref` query param. We use it to look up the pending connection
 * row, mark it active, and bounce the user to the account-mapping
 * wizard.
 *
 * On any failure the connection is marked status='error' with
 * lastError set, and the user is redirected to /settings/connections
 * with an error toast hint in the query string. We never throw a
 * 500 to a browser bouncing back from the bank (that surface is
 * non-recoverable for the user); always end on a redirect.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const ref = url.searchParams.get('ref');

  if (!ref || !/^\d+$/.test(ref)) {
    return redirectWithError(url.origin, 'Invalid callback (missing or malformed ref)');
  }

  const connectionId = parseInt(ref, 10);
  const conn = await bankingRepo.getConnection(connectionId).catch(() => null);
  if (!conn) {
    return redirectWithError(url.origin, `Connection ${connectionId} not found`);
  }

  // Confirm with the aggregator that consent actually completed.
  // listAccounts will only return rows once the requisition status
  // has flipped to LN (linked); if the user bailed mid-flow we get
  // an empty list or an aggregator-side error.
  try {
    const accounts = await gocardless.listAccounts(conn.aggregatorRef);

    if (accounts.length === 0) {
      await bankingRepo.setConnectionStatus(connectionId, 'error', {
        lastError: 'Consent did not complete (the aggregator returned no accounts)',
      });
      return redirectWithError(url.origin, 'Consent was not completed');
    }

    await bankingRepo.setConnectionStatus(connectionId, 'active', { lastError: null });
    return NextResponse.redirect(`${url.origin}/settings/connections/${connectionId}/map`);
  } catch (err) {
    const msg = err instanceof GoCardlessApiError
      ? `GoCardless ${err.status} during account fetch`
      : err instanceof Error ? err.message : 'unknown';
    console.error('Connect callback failed:', err);
    await bankingRepo.setConnectionStatus(connectionId, 'error', { lastError: msg });
    return redirectWithError(url.origin, msg);
  }
}

function redirectWithError(origin: string, message: string) {
  const target = `${origin}/settings/connections?error=${encodeURIComponent(message)}`;
  return NextResponse.redirect(target);
}
