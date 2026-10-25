import type { MerchantResearchResult } from '@/lib/merchant-research/types';

export type CategorizationLeg = {
  accountId: number;
  accountName: string;
  accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
  ownerId: number | null;
  amount: string;
};

/** snapshot is calculated by PostgreSQL over the journal and its ledger context. */
export type CategorizationCandidate = {
  id: number;
  date: string;
  description: string;
  propertyId: number | null;
  merchantName: string | null;
  bankCategory: string | null;
  transactionType: string | null;
  currency: string | null;
  legs: CategorizationLeg[];
  snapshot: string;
  /** An unchanged review is revisited only for confirmed knowledge or one deterministic policy check. */
  pendingReview?: boolean;
};

export type CategorizationCategory = { id: number; name: string; parentId?: number | null };
export type CategorizationRule = {
  id?: number;
  pattern: string;
  categoryId: number;
  matchType: string | null;
  priority?: number;
  source?: string | null;
};
export type CategorizationDecision = {
  journalId: number;
  categoryId: number | null;
  confidence: number;
  reason: string;
  source: 'rule' | 'learned' | 'ai' | 'payee';
  status: 'applied' | 'needs_review';
  /** Public merchant identity evidence; never proof of a specific purchase. */
  evidence?: MerchantResearchResult;
  /** Private user-confirmed payee provenance; never sent to public search. */
  payeeMemoryId?: string;
  payeeMemoryRevision?: number;
};

export type CategorizationOptions = {
  journalIds?: number[];
  syncRunIds?: number[];
  source?: 'manual' | 'import' | 'bank-sync' | 'scheduled';
  limit?: number;
  /** Internal snapshot scope for a durable job; later imports are a separate run. */
  maxJournalId?: number;
  /** One shared model budget; individual attempts are capped and may retry once with a smaller batch. */
  modelTimeoutMs?: number;
  /** Overall run budget, including deterministic processing; maximum 45 seconds. */
  deadlineMs?: number;
};

export type CategorizationCounts = { remaining: number; needsReview: number; available: number };
export type CategorizationResult = CategorizationCounts & {
  scopeAvailable?: number;
  total: number;
  ruleBased: number;
  aiCategorized: number;
  learned: number;
  aiNoMatch: number;
  reviewQueued: number;
  /** Existing reviews checked against a new deterministic policy, still awaiting user evidence. */
  reviewsRechecked?: number;
  conflicts: number;
  aiSkippedReason: string | null;
  hasMore: boolean;
  status: 'complete' | 'partial' | 'unavailable';
  batches: number;
  busy: boolean;
  reviewUrl: '/data';
  deferredReason?: 'time_budget' | 'model_unavailable' | 'model_failed' | 'no_categories' | 'busy' | null;
};
