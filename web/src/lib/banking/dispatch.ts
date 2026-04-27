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

/**
 * Returns a usable Monzo access token for the connection, refreshing
 * if the saved one is within REFRESH_MARGIN_MS of expiry. Persists
 * the rotated token bundle BEFORE returning so the caller can't
 * accidentally use a stale access token after a successful refresh.
 *
 * Throws MonzoAuthError if the refresh itself fails (the connection
 * needs reauth).
 */
export async function getMonzoAccessToken(connectionId: number): Promise<string> {
  const db = getDb();
  const rows = await db.execute(sql`
    SELECT encrypted_secret FROM connections WHERE id = ${connectionId} LIMIT 1
  `);
  const raw = rows.rows[0]?.encrypted_secret as Buffer | Uint8Array | null;
  if (!raw) throw new Error(`Connection ${connectionId} has no encrypted_secret recorded`);
  const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
  const bundle = decodeTokenBundle(buf);

  if (bundle.accessExpiresAtMs - REFRESH_MARGIN_MS > Date.now()) {
    return bundle.accessToken;
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
