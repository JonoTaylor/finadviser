/**
 * Banking aggregator adapter interface.
 *
 * The four-bank-aggregator integration is built behind this interface
 * so the choice of aggregator (currently GoCardless Bank Account Data,
 * with TrueLayer reserved as a fallback) is reversible at one file
 * without schema changes. The interface is intentionally narrow:
 * everything the daily sync, the connect flow, and the reauth flow
 * need, and nothing else.
 *
 * All money values cross this boundary as decimal strings, never
 * floats, to preserve the source bank's precision (Postgres NUMERIC
 * accepts the string directly).
 */

export type ProviderSlug = 'monzo' | 'barclays' | 'amex_uk' | 'yonder';

export interface InstitutionInfo {
  /** Aggregator-specific institution id (e.g. GoCardless `MONZO_MONZGB2L`). */
  id: string;
  name: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  logoUrl: string | null;
  /** Resolved match against our seeded providers, if any. Lets the UI
   *  surface coverage status for the four banks we care about. */
  knownProvider: ProviderSlug | null;
  /** Maximum days the aggregator will let an end-user-agreement run
   *  before forced reauth. UK PSD2 caps this at 90. */
  consentMaxDays: number;
  /** Maximum historical days the aggregator will return on first sync. */
  transactionsMaxHistoricalDays: number;
}

export interface CreateConsentInput {
  institutionId: string;
  /** Where the bank should redirect the user back to after consent.
   *  Must be on an HTTPS host the aggregator has whitelisted (handled
   *  in the GoCardless dashboard). */
  redirectUri: string;
  /** Our connection id, sent through and echoed back so we can match
   *  the post-consent callback to the originating row. */
  reference: string;
  /** How many days back to ingest on first sync. Capped to the
   *  institution's `transactionsMaxHistoricalDays`. */
  maxHistoricalDays: number;
}

export interface CreateConsentResult {
  /** Aggregator-side handle stored on connections.aggregator_ref.
   *  Not a credential, just an identifier. */
  aggregatorRef: string;
  /** URL we redirect the user to so they can authenticate with their
   *  bank. */
  consentUrl: string;
  /** When the resulting consent expires (PSD2 90-day clock). */
  consentExpiresAt: Date;
}

export interface AggregatorAccount {
  aggregatorAccountRef: string;
  iban: string | null;
  currency: string;
  ownerName: string | null;
  /** Free-form bank-side product name e.g. "Current Account",
   *  "Credit Card", "Joint Account". */
  product: string | null;
  /** Aggregator-side account-type slug. Monzo: "uk_retail",
   *  "uk_retail_joint", "uk_loan", "uk_rewards", etc. GoCardless
   *  doesn't expose this in a stable form so it stays null on that
   *  path. The mapping wizard uses it to default-skip non-everyday
   *  account types so the user only has to think about their
   *  spending account(s). */
  type: string | null;
}

export type TransactionStatus = 'pending' | 'settled';

export interface AggregatorTransaction {
  aggregatorTxnId: string;
  /** YYYY-MM-DD in the bank's local timezone. */
  date: string;
  /** Booking-side amount (typically GBP for UK accounts).
   *  Signed: positive is money in, negative is money out. */
  amount: string;
  currency: string;
  /** Foreign-side amount when the merchant charged in another currency. */
  originalAmount: string | null;
  originalCurrency: string | null;
  fxRate: string | null;
  /** What the bank wrote in the description / reference field. */
  description: string;
  merchantName: string | null;
  status: TransactionStatus;
  /** Bank-supplied category if any (Monzo's Plus tier surfaces these). */
  bankCategory: string | null;
  /** Everything the aggregator returned, preserved for debugging /
   *  future field promotions. Stored on transaction_metadata.raw. */
  raw: Record<string, unknown>;
}

export interface ListTransactionsInput {
  aggregatorAccountRef: string;
  /** YYYY-MM-DD; no earlier than the institution's max historical
   *  window. Daily sync should pass last_synced_at minus a small
   *  overlap (e.g. 3 days) to catch any pending->settled flips. */
  dateFrom?: string;
  /** YYYY-MM-DD; defaults to today. */
  dateTo?: string;
}

export interface BankingAggregator {
  /** Returns institutions in a given country (ISO 3166-1 alpha-2).
   *  Used by the smoke-test endpoint and the institution picker on
   *  first-connect. */
  listInstitutions(country: string): Promise<InstitutionInfo[]>;

  /** Creates an end-user agreement + requisition (or aggregator
   *  equivalent) and returns the URL to send the user to. */
  createConsent(input: CreateConsentInput): Promise<CreateConsentResult>;

  /** After consent completes, lists the accounts the aggregator now
   *  has access to. Called once during the first-connect flow so the
   *  user can map each aggregator account to one of our internal
   *  accounts. */
  listAccounts(aggregatorRef: string): Promise<AggregatorAccount[]>;

  /** Pulls transactions for one account in one date window. The
   *  daily-cron caller is responsible for chunking and rate-limit
   *  budgeting. */
  listTransactions(input: ListTransactionsInput): Promise<AggregatorTransaction[]>;
}
