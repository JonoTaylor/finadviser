/**
 * Per-connection adapter dispatch. Connections can be backed by
 * different aggregators (GoCardless brokered, Monzo direct, future
 * TrueLayer). The rest of the app shouldn't have to care which one;
 * these helpers take a connection and route to the right
 * implementation, including handling per-connection auth state for
 * Monzo (proactive token refresh, encrypted-secret round-trips).
 *
 * Why not an interface method? The BankingAggregator interface
 * (lib/banking/aggregator.ts) is intentionally narrow and stateless
 * — designed for app-wide credentials. Monzo's per-connection
 * tokens don't fit that shape without adding context to every
 * method, so the dispatch lives here as a thin per-call layer.
 */

import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import {
  gocardless,
} from './gocardless';
import {
  listMonzoAccounts,
  listMonzoTransactions,
  refreshMonzoTokens,
  decodeTokenBundle,
  encodeTokenBundle,
  MonzoAuthError,
  type MonzoTokenBundle,
} from './monzo';
import { bankingRepo, type ConnectionRow } from './repo';
import type {
  AggregatorAccount,
  AggregatorTransaction,
  ListTransactionsInput,
} from './aggregator';

const REFRESH_MARGIN_MS = 2 * 60 * 60 * 1000; // refresh if < 2 hours left

// In-flight refresh promises keyed by connectionId. Concurrent
// callers (e.g. the daily cron firing while a manual sync is mid-
// flight) get the same promise instead of both racing to refresh -
// otherwise one wins, the other ends up with the now-invalidated
// old refresh token, and the connection gets falsely marked errored.
//
// This is a process-level lock: it prevents races within a single
// Vercel function instance, not across instances. For a single-user
// app the cross-instance window is narrow (the cron and a user-
// initiated sync rarely fire on different instances within the
// ~1-second refresh round-trip) and the worst case is just a
// transient false error tip from the cron, recoverable on the next
// run. A truly cross-instance lock would need an advisory lock or
// a Postgres function around the whole refresh, which isn't
// possible with neon-http's no-multi-statement-tx model.
const refreshInFlight = new Map<number, Promise<string>>();

export function _resetRefreshInFlightForTests() {
  refreshInFlight.clear();
}

/**
 * Returns a usable Monzo access token for the connection, refreshing
 * if the saved one is within REFRESH_MARGIN_MS of expiry. Persists
 * the rotated token bundle BEFORE returning so the caller can't
 * accidentally use a stale access token after a successful refresh.
 *
 * Concurrent calls for the same connection share a single refresh
 * round-trip via `refreshInFlight`. Throws MonzoAuthError if the
 * refresh itself fails (the connection needs reauth).
 */
export async function getMonzoAccessToken(connectionId: number): Promise<string> {
  // Fast path: read once and check expiry. If the cached bundle is
  // still fresh (> REFRESH_MARGIN_MS to expiry), use it directly,
  // no lock needed.
  const bundle = await readMonzoBundle(connectionId);
  if (bundle.accessExpiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
    return bundle.accessToken;
  }

  // Slow path: needs refresh. If another caller is already refreshing
  // this connection, await theirs; otherwise we own the round-trip.
  const existing = refreshInFlight.get(connectionId);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Re-read inside the locked section in case another instance
      // (different Vercel cold-start) just rotated the tokens. If
      // the re-read shows fresh tokens we don't need to refresh
      // again.
      const fresh = await readMonzoBundle(connectionId);
      if (fresh.accessExpiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
        return fresh.accessToken;
      }
      // Bundle has no refresh token (manual / non-confidential
      // playground path). Mark the connection expired so the cron
      // and the connections UI prompt the user to paste a new
      // token rather than throw a confusing 401 from a refresh
      // attempt that can never succeed.
      if (!fresh.refreshToken) {
        await bankingRepo.setConnectionStatus(connectionId, 'expired', {
          lastError: 'Access token expired. Paste a fresh token from https://developers.monzo.com/api/playground via the manual-token form on /settings/connections.',
        }).catch(() => { /* best effort */ });
        throw new MonzoAuthError({
          message: 'Access token expired and no refresh token available; paste a new playground token to reconnect.',
        });
      }
      return await rotateAndPersist(connectionId, fresh);
    } finally {
      refreshInFlight.delete(connectionId);
    }
  })();
  refreshInFlight.set(connectionId, promise);
  return promise;
}

async function readMonzoBundle(connectionId: number): Promise<MonzoTokenBundle> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT encrypted_secret FROM connections WHERE id = ${connectionId} LIMIT 1
  `);
  const raw = rows.rows[0]?.encrypted_secret;
  if (raw === null || raw === undefined) {
    throw new Error(`Connection ${connectionId} has no encrypted_secret recorded`);
  }
  // decodeTokenBundle accepts Buffer / Uint8Array / hex-prefixed
  // string, which is what neon-http hands back from a raw db.execute
  // against a BYTEA column.
  return decodeTokenBundle(raw as Buffer | Uint8Array | string);
}

async function rotateAndPersist(connectionId: number, bundle: MonzoTokenBundle): Promise<string> {
  // Caller guarantees refreshToken is present (it bails out
  // earlier with MonzoAuthError if not). The non-null assertion
  // makes the type explicit at the call site of refreshMonzoTokens
  // without restructuring the surrounding flow.
  if (!bundle.refreshToken) {
    throw new Error('rotateAndPersist called with missing refreshToken (caller bug)');
  }
  // Refresh. Per Monzo docs: the response includes both a new access
  // token AND a new refresh token; the old refresh token is now
  // dead. Persist the new bundle BEFORE returning the access token,
  // otherwise a failure between here and the next API call would
  // leave us with a token in memory that we can never refresh again.
  const fresh = await refreshMonzoTokens(bundle.refreshToken);
  const next: MonzoTokenBundle = {
    accessToken: fresh.access_token,
    refreshToken: fresh.refresh_token,
    accessExpiresAtMs: fresh.accessExpiresAtMs,
    webhookToken: bundle.webhookToken,
  };
  const encoded = encodeTokenBundle(next);
  const db = getDb();
  await db.execute(sql`
    UPDATE connections
       SET encrypted_secret = ${encoded},
           monzo_access_expires_at = ${new Date(fresh.accessExpiresAtMs)},
           updated_at = now()
     WHERE id = ${connectionId}
  `);
  return next.accessToken;
}

/**
 * Lists the aggregator-side accounts available for this connection,
 * regardless of which aggregator backs it.
 */
export async function listAccountsForConnection(conn: ConnectionRow): Promise<AggregatorAccount[]> {
  if (conn.providerSlug === 'monzo') {
    const access = await getMonzoAccessToken(conn.id);
    return listMonzoAccounts(access);
  }
  return gocardless.listAccounts(conn.aggregatorRef);
}

/**
 * Lists transactions for one account on this connection, dispatching
 * by aggregator. The Monzo path handles token refresh transparently;
 * the GoCardless path uses the app-wide credentials.
 */
export async function listTransactionsForConnection(
  conn: ConnectionRow,
  input: ListTransactionsInput,
): Promise<AggregatorTransaction[]> {
  if (conn.providerSlug === 'monzo') {
    const access = await getMonzoAccessToken(conn.id);
    try {
      return await listMonzoTransactions(access, input);
    } catch (err) {
      if (err instanceof MonzoAuthError) {
        // Token died despite our refresh check — flag the connection
        // for reconnect so the cron / user gets a clear error.
        await bankingRepo.setConnectionStatus(conn.id, 'error', { lastError: err.message }).catch(() => {});
      }
      throw err;
    }
  }
  return gocardless.listTransactions(input);
}
