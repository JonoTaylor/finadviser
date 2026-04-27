/**
 * GoCardless Bank Account Data (formerly Nordigen) implementation of
 * the BankingAggregator interface.
 *
 * Auth model:
 *   - We hold app-wide credentials: GOCARDLESS_BAD_SECRET_ID +
 *     GOCARDLESS_BAD_SECRET_KEY, set in Vercel env. These are NOT
 *     end-user bank credentials, and they aren't per-connection.
 *   - We exchange them for an access token (24h) + refresh token (30d)
 *     and cache the access token in module-level state. The cache is
 *     shared across all requests in a serverless invocation; cold
 *     starts will mint a fresh token, which is fine.
 *   - Every connection's per-bank consent is just a `requisition_id`
 *     stored on connections.aggregator_ref. Not a credential.
 *
 * Error model:
 *   - 401 from GoCardless after a refresh attempt -> bubble up as
 *     GoCardlessAuthError so the caller can mark the connection
 *     errored and surface a reauth prompt.
 *   - 429 -> GoCardlessRateLimitError with the Retry-After hint;
 *     daily cron should back off rather than retry hot.
 *   - All other 4xx/5xx -> GoCardlessApiError with status + body.
 */

import type {
  BankingAggregator,
  InstitutionInfo,
  CreateConsentInput,
  CreateConsentResult,
  AggregatorAccount,
  AggregatorTransaction,
  ListTransactionsInput,
  ProviderSlug,
} from './aggregator';

const BASE_URL = 'https://bankaccountdata.gocardless.com/api/v2';

// PSD2 caps consent at 90 days; default a touch lower so the UI clock
// matches what the bank actually granted (some banks return 89 in
// edge cases).
const DEFAULT_CONSENT_DAYS = 90;
const DEFAULT_HISTORICAL_DAYS = 730; // GoCardless caps most banks at ~730 (24m)

// Match aggregator institution ids to our four seeded providers. The
// matching is heuristic on the GoCardless id prefix, which is stable
// per institution. If GoCardless renames an id we'd need to update
// this map; the seed table on the DB side stays the same.
const KNOWN_INSTITUTION_PREFIXES: Array<{ prefix: string; provider: ProviderSlug }> = [
  { prefix: 'MONZO_',                    provider: 'monzo' },
  { prefix: 'BARCLAYS_',                 provider: 'barclays' },
  { prefix: 'AMERICAN_EXPRESS_',         provider: 'amex_uk' },
  { prefix: 'YONDER_',                   provider: 'yonder' },
];

function classifyInstitution(id: string): ProviderSlug | null {
  for (const { prefix, provider } of KNOWN_INSTITUTION_PREFIXES) {
    if (id.startsWith(prefix)) return provider;
  }
  return null;
}

// ----- Errors ------------------------------------------------------

export class GoCardlessApiError extends Error {
  constructor(public readonly status: number, public readonly body: unknown, message?: string) {
    super(message ?? `GoCardless ${status}: ${typeof body === 'string' ? body : JSON.stringify(body)}`);
    this.name = 'GoCardlessApiError';
  }
}

export class GoCardlessAuthError extends GoCardlessApiError {
  constructor(body: unknown) {
    super(401, body, 'GoCardless auth failed (check GOCARDLESS_BAD_SECRET_ID / SECRET_KEY)');
    this.name = 'GoCardlessAuthError';
  }
}

export class GoCardlessRateLimitError extends GoCardlessApiError {
  constructor(public readonly retryAfterSeconds: number, body: unknown) {
    super(429, body, `GoCardless rate-limited; retry after ${retryAfterSeconds}s`);
    this.name = 'GoCardlessRateLimitError';
  }
}

// ----- Token cache -------------------------------------------------

interface TokenState {
  access: string;
  /** Unix ms when the access token stops being valid. We mint a new
   *  one a minute before this to avoid edge-of-second races. */
  accessExpiresAtMs: number;
  refresh: string;
  refreshExpiresAtMs: number;
}

let tokenCache: TokenState | null = null;
const ACCESS_REFRESH_MARGIN_MS = 60_000;

async function postJson<T>(path: string, body: unknown, headers: Record<string, string> = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await readBody(res);
    if (res.status === 401) throw new GoCardlessAuthError(errBody);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new GoCardlessRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60, errBody);
    }
    throw new GoCardlessApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string, accessToken: string): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    const errBody = await readBody(res);
    if (res.status === 401) throw new GoCardlessAuthError(errBody);
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('Retry-After') ?? '60', 10);
      throw new GoCardlessRateLimitError(Number.isFinite(retryAfter) ? retryAfter : 60, errBody);
    }
    throw new GoCardlessApiError(res.status, errBody);
  }
  return res.json() as Promise<T>;
}

async function readBody(res: Response): Promise<unknown> {
  const ct = res.headers.get('Content-Type') ?? '';
  if (ct.includes('application/json')) {
    try { return await res.json(); } catch { return null; }
  }
  return res.text().catch(() => null);
}

interface NewTokenResponse {
  access: string;
  access_expires: number;
  refresh: string;
  refresh_expires: number;
}

interface RefreshTokenResponse {
  access: string;
  access_expires: number;
}

async function mintTokens(secretId: string, secretKey: string): Promise<TokenState> {
  const res = await postJson<NewTokenResponse>('/token/new/', {
    secret_id: secretId,
    secret_key: secretKey,
  });
  const now = Date.now();
  return {
    access: res.access,
    accessExpiresAtMs: now + res.access_expires * 1000,
    refresh: res.refresh,
    refreshExpiresAtMs: now + res.refresh_expires * 1000,
  };
}

async function refreshAccess(state: TokenState): Promise<TokenState> {
  const res = await postJson<RefreshTokenResponse>('/token/refresh/', { refresh: state.refresh });
  return {
    ...state,
    access: res.access,
    accessExpiresAtMs: Date.now() + res.access_expires * 1000,
  };
}

async function getAccessToken(): Promise<string> {
  const secretId = process.env.GOCARDLESS_BAD_SECRET_ID;
  const secretKey = process.env.GOCARDLESS_BAD_SECRET_KEY;
  if (!secretId || !secretKey) {
    throw new Error('GoCardless BAD credentials missing: set GOCARDLESS_BAD_SECRET_ID and GOCARDLESS_BAD_SECRET_KEY');
  }

  const now = Date.now();
  if (tokenCache && tokenCache.accessExpiresAtMs - ACCESS_REFRESH_MARGIN_MS > now) {
    return tokenCache.access;
  }
  if (tokenCache && tokenCache.refreshExpiresAtMs > now) {
    try {
      tokenCache = await refreshAccess(tokenCache);
      return tokenCache.access;
    } catch (err) {
      // Refresh failed; fall through to a clean mint.
      if (!(err instanceof GoCardlessAuthError)) throw err;
    }
  }
  tokenCache = await mintTokens(secretId, secretKey);
  return tokenCache.access;
}

// Module-internal export so tests can reset the cache between cases.
export function _resetTokenCacheForTests() {
  tokenCache = null;
}

// ----- Wire-format types ------------------------------------------

interface RawInstitution {
  id: string;
  name: string;
  bic?: string;
  transaction_total_days?: string;
  countries?: string[];
  logo?: string;
  max_access_valid_for_days?: string;
}

interface RawAgreement {
  id: string;
  max_historical_days: number;
  access_valid_for_days: number;
  access_scope: string[];
  accepted: string | null;
  institution_id: string;
}

interface RawRequisition {
  id: string;
  status: string;
  agreements: string;
  accounts: string[];
  reference: string;
  user_language: string | null;
  link: string;
  ssn: string | null;
  account_selection: boolean;
  redirect_immediate: boolean;
}

interface RawAccountDetailsWrapper {
  account: {
    iban?: string;
    currency?: string;
    ownerName?: string;
    name?: string;
    product?: string;
    cashAccountType?: string;
  };
}

interface RawTransaction {
  transactionId?: string;
  internalTransactionId?: string;
  bookingDate?: string;
  valueDate?: string;
  bookingDateTime?: string;
  transactionAmount: { amount: string; currency: string };
  currencyExchange?: Array<{
    sourceCurrency: string;
    targetCurrency: string;
    instructedAmount?: { amount: string; currency: string };
    exchangeRate: string;
  }>;
  remittanceInformationUnstructured?: string;
  remittanceInformationUnstructuredArray?: string[];
  creditorName?: string;
  debtorName?: string;
  proprietaryBankTransactionCode?: string;
  merchantCategoryCode?: string;
  additionalInformation?: string;
}

interface RawTransactionsResponse {
  transactions: {
    booked: RawTransaction[];
    pending: RawTransaction[];
  };
}

interface RawAccountsList {
  accounts: string[];
}

// ----- Implementation ---------------------------------------------

export const gocardless: BankingAggregator = {
  async listInstitutions(country: string): Promise<InstitutionInfo[]> {
    const access = await getAccessToken();
    const raw = await getJson<RawInstitution[]>(`/institutions/?country=${encodeURIComponent(country.toLowerCase())}`, access);
    return raw.map((r) => ({
      id: r.id,
      name: r.name,
      country: country.toUpperCase(),
      logoUrl: r.logo ?? null,
      knownProvider: classifyInstitution(r.id),
      consentMaxDays: parseDaysOrDefault(r.max_access_valid_for_days, DEFAULT_CONSENT_DAYS),
      transactionsMaxHistoricalDays: parseDaysOrDefault(r.transaction_total_days, DEFAULT_HISTORICAL_DAYS),
    }));
  },

  async createConsent(input: CreateConsentInput): Promise<CreateConsentResult> {
    const access = await getAccessToken();

    // Step 1: end-user agreement. Setting max_historical_days +
    // access_valid_for_days here gives us deterministic expiry maths
    // even when the bank silently caps lower (we re-read the agreement
    // on the next step to capture the actual accepted value).
    const agreement = await postJson<RawAgreement>(
      '/agreements/enduser/',
      {
        institution_id: input.institutionId,
        max_historical_days: input.maxHistoricalDays,
        access_valid_for_days: DEFAULT_CONSENT_DAYS,
        access_scope: ['balances', 'details', 'transactions'],
      },
      { Authorization: `Bearer ${access}` },
    );

    // Step 2: requisition wraps the agreement and returns the consent
    // URL we send the user to.
    const requisition = await postJson<RawRequisition>(
      '/requisitions/',
      {
        redirect: input.redirectUri,
        institution_id: input.institutionId,
        agreement: agreement.id,
        reference: input.reference,
        user_language: 'EN',
      },
      { Authorization: `Bearer ${access}` },
    );

    const consentExpiresAt = new Date(Date.now() + agreement.access_valid_for_days * 86_400_000);

    return {
      aggregatorRef: requisition.id,
      consentUrl: requisition.link,
      consentExpiresAt,
    };
  },

  async listAccounts(aggregatorRef: string): Promise<AggregatorAccount[]> {
    const access = await getAccessToken();
    const requisition = await getJson<RawAccountsList & { id: string }>(
      `/requisitions/${encodeURIComponent(aggregatorRef)}/`,
      access,
    );

    // Each account id needs a separate /details/ call to populate
    // IBAN, currency, product, ownerName. GoCardless doesn't return
    // these on the requisition payload itself.
    const out: AggregatorAccount[] = [];
    for (const accountId of requisition.accounts) {
      const detail = await getJson<RawAccountDetailsWrapper>(
        `/accounts/${encodeURIComponent(accountId)}/details/`,
        access,
      );
      out.push({
        aggregatorAccountRef: accountId,
        iban: detail.account.iban ?? null,
        currency: detail.account.currency ?? 'GBP',
        ownerName: detail.account.ownerName ?? null,
        product: detail.account.product ?? detail.account.name ?? detail.account.cashAccountType ?? null,
      });
    }
    return out;
  },

  async listTransactions(input: ListTransactionsInput): Promise<AggregatorTransaction[]> {
    const access = await getAccessToken();
    const params = new URLSearchParams();
    if (input.dateFrom) params.set('date_from', input.dateFrom);
    if (input.dateTo) params.set('date_to', input.dateTo);
    const qs = params.toString();
    const path = `/accounts/${encodeURIComponent(input.aggregatorAccountRef)}/transactions/${qs ? `?${qs}` : ''}`;
    const raw = await getJson<RawTransactionsResponse>(path, access);

    const settled = raw.transactions.booked.map((t) => normaliseTxn(t, 'settled'));
    const pending = raw.transactions.pending.map((t) => normaliseTxn(t, 'pending'));
    // Settled before pending so when both lists contain the same id
    // (rare; happens in the milliseconds around the booking flip), the
    // settled record wins downstream.
    return [...settled, ...pending];
  },
};

function normaliseTxn(t: RawTransaction, status: 'pending' | 'settled'): AggregatorTransaction {
  const id = t.transactionId ?? t.internalTransactionId;
  if (!id) {
    // GoCardless guarantees one or the other for every txn; the only
    // way this fires is on a malformed payload that the upstream API
    // shouldn't have produced. Fail loudly.
    throw new Error('GoCardless transaction with no id (transactionId / internalTransactionId both missing)');
  }
  const date = t.bookingDate ?? t.valueDate ?? (t.bookingDateTime?.slice(0, 10));
  if (!date) throw new Error(`GoCardless txn ${id} has no booking/value date`);

  const fx = t.currencyExchange?.[0];

  const description =
    t.remittanceInformationUnstructured
    ?? t.remittanceInformationUnstructuredArray?.join(' ')
    ?? t.additionalInformation
    ?? t.creditorName
    ?? t.debtorName
    ?? '';

  const merchantName = t.creditorName ?? t.debtorName ?? null;

  return {
    aggregatorTxnId: id,
    date,
    amount: t.transactionAmount.amount,
    currency: t.transactionAmount.currency,
    originalAmount: fx?.instructedAmount?.amount ?? null,
    originalCurrency: fx?.instructedAmount?.currency ?? fx?.sourceCurrency ?? null,
    fxRate: fx?.exchangeRate ?? null,
    description,
    merchantName,
    status,
    bankCategory: t.proprietaryBankTransactionCode ?? t.merchantCategoryCode ?? null,
    raw: t as unknown as Record<string, unknown>,
  };
}

function parseDaysOrDefault(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
