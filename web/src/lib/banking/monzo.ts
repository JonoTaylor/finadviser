/**
 * Direct Monzo API integration. Monzo exposes a public OAuth API
 * (https://docs.monzo.com) that gives much richer transaction
 * metadata than the GoCardless brokered feed: human merchant names,
 * emoji, lat/long, the Monzo category taxonomy, the merchant
 * `group_id` for "all my Pret spending"-style queries, and
 * real-time webhooks. This adapter handles the full OAuth dance
 * directly with Monzo (we hold the user's tokens, not an aggregator).
 *
 * Auth model differs from GoCardless meaningfully:
 *   - We hold per-user OAuth refresh + access tokens, encrypted via
 *     `lib/banking/encryption.ts` and stored on
 *     connections.encrypted_secret as JSON.
 *   - Access token lives 6 hours; refresh is destructive (using a
 *     refresh token immediately invalidates the old one and returns
 *     a new one). The new token MUST be persisted before the next
 *     API call or we're locked out.
 *   - SCA: after token exchange the user must tap "Allow" in their
 *     Monzo app. Until they do, every API call returns 403. We
 *     surface this as a polled wait state on the connect flow.
 *   - Historical-window quirk: ~5 minutes after consent grant, the
 *     full transaction history is fetchable; after that the API
 *     silently caps to ~90 days. So initial backfill must happen in
 *     the same flow that completes consent.
 *
 * Money: Monzo amounts are integer pence with the bank's sign
 * convention (negative = debit). We convert to decimal-string GBP
 * matching the AggregatorTransaction shape.
 */

import type {
  AggregatorAccount,
  AggregatorTransaction,
  ListTransactionsInput,
  ProviderSlug,
} from './aggregator';
import { encryptSecret, decryptSecret } from './encryption';

const BASE_URL = 'https://api.monzo.com';
const AUTH_URL = 'https://auth.monzo.com';

// ── Errors ────────────────────────────────────────────────────────

export class MonzoApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message?: string) {
    super(message ?? `Monzo ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'MonzoApiError';
  }
}

export class MonzoSCAPendingError extends MonzoApiError {
  constructor(body: unknown) {
    super(403, body, 'Monzo Strong Customer Authentication is still pending. Open the Monzo app and tap Allow.');
    this.name = 'MonzoSCAPendingError';
  }
}

export class MonzoAuthError extends MonzoApiError {
  constructor(body: unknown) {
    super(401, body, 'Monzo OAuth token is invalid or expired. Reconnect in /settings/connections.');
    this.name = 'MonzoAuthError';
  }
}

// ── Token storage shape ──────────────────────────────────────────
//
// Stored encrypted on connections.encrypted_secret as a JSON blob.
// `accessExpiresAtMs` is denormalised onto connections.monzo_access_
// expires_at too so the cron can query "expiring tokens" without
// decrypting the secret of every connection.

export interface MonzoTokenBundle {
  accessToken: string;
  /**
   * Refresh token. Only issued by Monzo to OAuth clients marked
   * Confidential at create time. For non-confidential clients
   * (the default for new developer-portal accounts) this is
   * absent and tokens have to be rotated by manually pasting a
   * fresh playground-issued token every 6 hours - see the manual-
   * token connect path on /settings/connections.
   */
  refreshToken?: string;
  /** Unix ms when the access token stops being valid. */
  accessExpiresAtMs: number;
  /** Random URL-safe nonce that doubles as the webhook URL secret. */
  webhookToken: string;
}

export function encodeTokenBundle(bundle: MonzoTokenBundle): Buffer {
  return encryptSecret(JSON.stringify(bundle));
}

export function decodeTokenBundle(raw: Buffer | Uint8Array | string | null | undefined): MonzoTokenBundle {
  // The neon-http transport surfaces BYTEA columns as a Postgres-
  // wire-format hex-prefixed string ("\xABCD...") when read via raw
  // db.execute(sql`...`); only the typed Drizzle ORM path runs the
  // bytea-customType decoder. Accept all three shapes here so
  // callers don't have to know which path they took.
  if (raw === null || raw === undefined) {
    throw new Error('Decrypted Monzo token bundle is empty (no encrypted_secret recorded)');
  }
  let buf: Buffer;
  if (Buffer.isBuffer(raw)) {
    buf = raw;
  } else if (raw instanceof Uint8Array) {
    buf = Buffer.from(raw);
  } else if (typeof raw === 'string') {
    const hex = raw.startsWith('\\x') ? raw.slice(2) : raw;
    buf = Buffer.from(hex, 'hex');
  } else {
    throw new Error(`Unsupported encrypted_secret driver value type: ${typeof raw}`);
  }

  const json = decryptSecret(buf);
  const parsed = JSON.parse(json) as MonzoTokenBundle;
  if (typeof parsed.accessToken !== 'string') {
    throw new Error('Decrypted Monzo token bundle is missing accessToken (corrupt secret or schema drift)');
  }
  // refreshToken is optional - non-confidential clients (and
  // playground-issued manual tokens) don't have one. Tokens without
  // a refresh path are handled by getMonzoAccessToken: when the
  // access token expires, the connection flips to 'expired' rather
  // than attempting a refresh that can never succeed.
  return parsed;
}

// ── Wire-format types ───────────────────────────────────────────

interface MonzoTokenResponse {
  access_token: string;
  client_id: string;
  expires_in: number;     // seconds
  refresh_token: string;  // present for confidential clients
  token_type: 'Bearer';
  user_id: string;
}

interface MonzoAccountWire {
  id: string;
  description: string;
  created: string;
  account_number?: string;
  sort_code?: string;
  currency?: string;
  type?: string;
  closed?: boolean;
  owners?: Array<{ user_id: string; preferred_name: string; preferred_first_name?: string }>;
}

interface MonzoMerchantWire {
  id: string;
  group_id?: string;
  name: string;
  category: string;
  logo?: string;
  emoji?: string;
  address?: {
    address?: string;
    city?: string;
    country?: string;
    postcode?: string;
    region?: string;
  };
}

interface MonzoTransactionWire {
  id: string;
  account_id: string;
  amount: number;
  currency: string;
  created: string;
  settled?: string;
  description: string;
  notes?: string;
  category?: string;
  is_load?: boolean;
  decline_reason?: string;
  merchant?: string | MonzoMerchantWire | null;
  metadata?: Record<string, string>;
  local_amount?: number;
  local_currency?: string;
}

// ── Public adapter ───────────────────────────────────────────────

export interface MonzoOAuthConfig {
  clientId: string;
  clientSecret: string;
}

function loadConfig(): MonzoOAuthConfig {
  const clientId = process.env.MONZO_CLIENT_ID;
  const clientSecret = process.env.MONZO_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Monzo OAuth credentials missing: set MONZO_CLIENT_ID and MONZO_CLIENT_SECRET in env');
  }
  return { clientId, clientSecret };
}

/**
 * Build the auth.monzo.com URL the user is redirected to. The
 * `state` doubles as our connection lookup key on the callback
 * (CSRF protection + connection-id mapping in one nonce).
 */
export function buildMonzoAuthUrl(params: { state: string; redirectUri: string }): string {
  const { clientId } = loadConfig();
  const url = new URL(`${AUTH_URL}/`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', params.state);
  return url.toString();
}

/**
 * Exchange an OAuth `code` (received on the callback) for an access
 * token + refresh token pair.
 */
export async function exchangeMonzoCode(params: {
  code: string;
  redirectUri: string;
}): Promise<MonzoTokenResponse & { accessExpiresAtMs: number }> {
  const { clientId, clientSecret } = loadConfig();
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: params.redirectUri,
    code: params.code,
  });
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const json = (await res.json()) as MonzoTokenResponse;
  return {
    ...json,
    accessExpiresAtMs: Date.now() + json.expires_in * 1000,
  };
}

/**
 * Refresh access (and refresh) tokens. Both rotate; the caller MUST
 * persist the response before issuing the next API call. Failure
 * mode is "manual reauth required", surfaced as MonzoAuthError on
 * the next call.
 */
export async function refreshMonzoTokens(refreshToken: string): Promise<MonzoTokenResponse & { accessExpiresAtMs: number }> {
  const { clientId, clientSecret } = loadConfig();
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${BASE_URL}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: body.toString(),
  });
  if (res.status === 401) throw new MonzoAuthError(await readBody(res));
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const json = (await res.json()) as MonzoTokenResponse;
  return {
    ...json,
    accessExpiresAtMs: Date.now() + json.expires_in * 1000,
  };
}

/**
 * Sanity-check the access token. Returns true if Monzo says we're
 * authenticated (SCA approved + token valid). False if SCA still
 * pending. Throws on real errors.
 */
export async function checkMonzoAuth(accessToken: string): Promise<boolean> {
  const res = await fetch(`${BASE_URL}/ping/whoami`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 401) throw new MonzoAuthError(await readBody(res));
  if (res.status === 403) return false;  // SCA pending
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const body = (await res.json()) as { authenticated: boolean };
  return body.authenticated;
}

/**
 * GET /accounts. Returns Monzo current accounts owned by this user.
 * Filtered to non-closed retail accounts (uk_retail + uk_retail_joint).
 */
export async function listMonzoAccounts(accessToken: string): Promise<AggregatorAccount[]> {
  const res = await fetch(`${BASE_URL}/accounts`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 403) throw new MonzoSCAPendingError(await readBody(res));
  if (res.status === 401) throw new MonzoAuthError(await readBody(res));
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const body = (await res.json()) as { accounts: MonzoAccountWire[] };
  return body.accounts
    .filter(a => !a.closed)
    .map(a => ({
      aggregatorAccountRef: a.id,
      iban: null,
      currency: a.currency ?? 'GBP',
      ownerName: a.owners?.[0]?.preferred_name ?? a.description,
      product: humanizeProduct(a.type, a.description),
      type: a.type ?? null,
    }));
}

function humanizeProduct(type?: string, description?: string): string | null {
  if (type === 'uk_retail') return 'Current account';
  if (type === 'uk_retail_joint') return 'Joint account';
  return description ?? type ?? null;
}

interface MonzoPotWire {
  id: string;
  name: string;
  currency?: string;
  balance?: number;
  deleted?: boolean;
  type?: string;
}

/**
 * GET /pots?current_account_id=...
 *
 * Monzo pots aren't returned by /accounts; they're fetched per main
 * account. This is the lookup we use to substitute human-readable pot
 * names ("Holiday Fund") for the raw `pot_xxx` IDs that otherwise
 * leak through as transaction descriptions on pot top-ups / withdrawals.
 *
 * Filtered to non-deleted pots. The returned map is id -> name; we
 * don't surface pots as separate AggregatorAccounts here because the
 * sync engine and journal-shape were built around real spending
 * accounts, and treating a pot as a sub-account is a follow-up refactor.
 */
export async function listMonzoPots(
  accessToken: string,
  currentAccountId: string,
): Promise<Map<string, string>> {
  const params = new URLSearchParams({ current_account_id: currentAccountId });
  const res = await fetch(`${BASE_URL}/pots?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (res.status === 403) throw new MonzoSCAPendingError(await readBody(res));
  if (res.status === 401) throw new MonzoAuthError(await readBody(res));
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const body = (await res.json()) as { pots: MonzoPotWire[] };
  const map = new Map<string, string>();
  for (const p of body.pots ?? []) {
    if (p.deleted) continue;
    if (p.id && p.name) map.set(p.id, p.name);
  }
  return map;
}

/**
 * GET /transactions with cursor pagination. Each page is up to 100
 * transactions (Monzo's max). When a page returns the full 100 we
 * issue another request using the last transaction id as the
 * `since` cursor; the loop ends when a page returns < 100 or 0
 * rows. expand[]=merchant inlines the merchant object so each page
 * is one round-trip rather than N+1.
 *
 * `since` accepts EITHER an RFC3339 timestamp OR a transaction id.
 * The first page uses the timestamp; subsequent pages switch to the
 * id-based cursor so we don't re-fetch transactions we've already
 * seen and never miss any when more than 100 land in the window.
 *
 * Safety cap (PAGE_LIMIT) prevents an infinite loop in the
 * pathological case where Monzo somehow returns 100 rows on every
 * page indefinitely. 50 pages = 5,000 transactions which is
 * comfortably more than any realistic 7-day window for a single
 * account; if we hit it, something is wrong upstream and we should
 * stop and surface it rather than DOS Monzo.
 */
const PAGE_LIMIT = 50;
const PAGE_SIZE = 100;

export async function listMonzoTransactions(
  accessToken: string,
  input: ListTransactionsInput,
): Promise<AggregatorTransaction[]> {
  const out: AggregatorTransaction[] = [];
  // First page: time-based `since`. Subsequent pages: id-based cursor.
  let sinceCursor: string | null = input.dateFrom ? `${input.dateFrom}T00:00:00Z` : null;

  // One-shot pot lookup: replace `pot_xxx` IDs in transaction
  // descriptions with the human pot name (e.g. "Holiday Fund").
  // Failures are non-fatal - the sync proceeds with raw IDs.
  let potNames: Map<string, string> = new Map();
  try {
    potNames = await listMonzoPots(accessToken, input.aggregatorAccountRef);
  } catch {
    /* swallow - non-fatal cosmetic */
  }

  for (let page = 0; page < PAGE_LIMIT; page++) {
    const params = new URLSearchParams();
    params.set('account_id', input.aggregatorAccountRef);
    params.append('expand[]', 'merchant');
    if (sinceCursor)  params.set('since', sinceCursor);
    if (input.dateTo) params.set('before', `${input.dateTo}T23:59:59Z`);
    params.set('limit', String(PAGE_SIZE));

    const res = await fetch(`${BASE_URL}/transactions?${params}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 403) throw new MonzoSCAPendingError(await readBody(res));
    if (res.status === 401) throw new MonzoAuthError(await readBody(res));
    if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
    const body = (await res.json()) as { transactions: MonzoTransactionWire[] };

    for (const t of body.transactions) {
      // Skip declined; they don't represent real money movement.
      if (!t.decline_reason) out.push(normaliseMonzoTxn(t, potNames));
    }

    if (body.transactions.length < PAGE_SIZE) break;
    // Next page: cursor on the last raw txn id, NOT the last
    // out-array id (which may have been filtered out by
    // decline_reason).
    sinceCursor = body.transactions[body.transactions.length - 1].id;
  }
  return out;
}

/**
 * Replace any `pot_xxx` substring in the description with the human
 * pot name. Pot top-ups land as `description: "pot_0000xxx..."` plus
 * `metadata.pot_id`; withdrawals are similar. Direction prefix
 * ("Transfer to" / "Transfer from") is added when we can infer it
 * from the amount sign.
 */
function describePotMovement(
  raw: string,
  potNames: Map<string, string>,
  amount: number,
): string {
  const m = raw.match(/^pot_[A-Za-z0-9]+$/);
  if (!m) return raw;
  const name = potNames.get(raw);
  if (!name) return raw;
  return amount < 0 ? `Transfer to ${name}` : `Transfer from ${name}`;
}

function normaliseMonzoTxn(
  t: MonzoTransactionWire,
  potNames: Map<string, string> = new Map(),
): AggregatorTransaction {
  // Monzo amount is integer pence; sign matches bank-perspective
  // (negative = debit). Convert to decimal GBP string.
  const sign = t.amount < 0 ? '-' : '';
  const abs = Math.abs(t.amount);
  const pounds = Math.floor(abs / 100);
  const pence = String(abs % 100).padStart(2, '0');
  const amountStr = `${sign}${pounds}.${pence}`;

  // Date: Monzo gives `created` (auth time) and `settled` (cleared
  // time). Use settled if present, else created. Both are RFC3339;
  // we only want the YYYY-MM-DD portion to match the journal model.
  const isoSource = t.settled || t.created;
  const date = isoSource.slice(0, 10);

  const merchant = typeof t.merchant === 'object' && t.merchant !== null ? t.merchant : null;

  // FX: when local_amount + local_currency are present and differ
  // from booking currency, surface them as the original-side fields.
  let originalAmount: string | null = null;
  let originalCurrency: string | null = null;
  if (
    typeof t.local_amount === 'number' &&
    typeof t.local_currency === 'string' &&
    t.local_currency !== t.currency
  ) {
    const lSign = t.local_amount < 0 ? '-' : '';
    const lAbs = Math.abs(t.local_amount);
    const lPounds = Math.floor(lAbs / 100);
    const lPence = String(lAbs % 100).padStart(2, '0');
    originalAmount = `${lSign}${lPounds}.${lPence}`;
    originalCurrency = t.local_currency;
  }

  // Description: prefer merchant.name (clean) over description
  // (often a cryptic card-network string). For pot top-ups /
  // withdrawals where Monzo writes the raw `pot_xxx` ID into
  // description, look up the pot's human name and substitute so the
  // /transactions UI shows "Transfer to Holiday Fund" instead of
  // "pot_0000Axh4pFtsoio7cstlEx".
  const rawDescription = merchant?.name ?? t.description ?? '';
  const description = describePotMovement(rawDescription, potNames, t.amount);
  const merchantName = merchant?.name ?? null;

  // Pending vs settled. Monzo: settled empty string means
  // authorised but not yet cleared. The rest of the pipeline
  // (PR D will handle pending->settled flips) treats both equally
  // for now.
  const status = t.settled ? 'settled' : 'pending';

  return {
    aggregatorTxnId: t.id,
    date,
    amount: amountStr,
    currency: t.currency,
    originalAmount,
    originalCurrency,
    fxRate: null,
    description,
    merchantName,
    status,
    bankCategory: t.category ?? null,
    raw: t as unknown as Record<string, unknown>,
  };
}

// ── Webhook helpers ──────────────────────────────────────────────
//
// Used by the webhook-registration follow-up PR. Defined here so the
// adapter is feature-complete from one file.

export async function registerMonzoWebhook(
  accessToken: string,
  accountId: string,
  url: string,
): Promise<{ id: string; url: string }> {
  const body = new URLSearchParams({ account_id: accountId, url });
  const res = await fetch(`${BASE_URL}/webhooks`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) throw new MonzoApiError(res.status, await readBody(res));
  const json = (await res.json()) as { webhook: { id: string; url: string } };
  return json.webhook;
}

export async function deleteMonzoWebhook(accessToken: string, webhookId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/webhooks/${encodeURIComponent(webhookId)}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new MonzoApiError(res.status, await readBody(res));
  }
}

// ── Helpers ──────────────────────────────────────────────────────

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  return res.text().catch(() => null);
}

/** Generates a URL-safe nonce, used for OAuth state and webhook URL secret. */
export function generateMonzoStateNonce(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Buffer.from(buf).toString('base64url');
}

// `monzoProvider` is the conceptual single institution this adapter
// covers. Surfaced so the connect flow can fill in InstitutionInfo
// without hitting an aggregator catalogue (Monzo IS the aggregator).
export const MONZO_PROVIDER_SLUG: ProviderSlug = 'monzo';
