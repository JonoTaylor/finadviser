/** Only merchant identity data is eligible for a public search. */
export type MerchantResearchInput = {
  merchantName: string | null;
  coarseLocation?: string | null;
  transactionType?: string | null;
  /** Local exclusion list. These names are never sent to a search provider. */
  privateNames?: readonly string[];
};

export type MerchantResearchQuery = {
  merchantName: string;
  coarseLocation: string | null;
  query: string;
  cacheKey: string;
};

export type MerchantResearchSource = {
  title: string;
  url: string;
  snippet: string;
  retrievedAt: string;
};

export type MerchantResearchStatus = 'matched' | 'no_matches' | 'unavailable' | 'timed_out' | 'skipped_private';

/** A matched search result is evidence of a possible merchant, never purchase purpose. */
export type MerchantResearchResult = {
  status: MerchantResearchStatus;
  query: string | null;
  sources: MerchantResearchSource[];
  researchedAt: string;
  provider: 'gateway_perplexity';
  scope: 'merchant_identity_only';
};

export type MerchantResearchOptions = { signal?: AbortSignal; timeoutMs?: number };
