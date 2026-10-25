import { randomUUID } from 'node:crypto';
import { categorizeContextBatch } from '@/lib/ai/claude-client';
import { buildMerchantResearchQuery, merchantResearchInputFromCandidate, validateMerchantResearchResult } from '@/lib/merchant-research/privacy';
import { researchMerchant } from '@/lib/merchant-research/service';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';
import { categoryRepo } from '@/lib/repos/category.repo';
import { propertyRepo } from '@/lib/repos/property.repo';
import { loadActivePayeeMemories, loadPrivatePayeeNames } from './payees/service';
import { matchingConfirmedPayees } from './payees/matching';
import { knownServiceMatch } from './known-services';
import { assessAutomaticSpending, hasMovementDescription, isFinancialOrBarePaymentProvider, isProtectedSpendingCategory } from './autonomy';
import { categorizationRepo } from './repository';
import {
  categorizationContextKey, confirmedContextReviewReason, MAX_PROCESSING_ENTRIES, MODEL_BATCH_SIZE, PAYEE_MEANINGS_CONFLICT_REASON,
  movementReviewReason, needsMovementReview, ruleDecision, validateModelDecisions,
} from './decisions';
import type {
  CategorizationCandidate, CategorizationDecision, CategorizationOptions, CategorizationResult,
} from './types';

// Small responses finish and persist sooner than a 25-entry response, which
// used to consume the entire shared model budget before saving any progress.
const INITIAL_MODEL_BATCH_SIZE = Math.min(5, MODEL_BATCH_SIZE);
const MODEL_ATTEMPT_TIMEOUT_MS = 8_000;
const MIN_RETRY_BUDGET_MS = 1_000;
const MAX_RESEARCH_QUERIES = 5;
const RESEARCH_TIMEOUT_MS = 6_000;

class CategorizationBatchTimeoutError extends Error {
  constructor() { super('The categorisation batch exceeded its execution budget.'); }
}

/** Enforce the bound even if a provider fails to settle when aborted. */
async function boundedOperation<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(controller.signal),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new CategorizationBatchTimeoutError());
          controller.abort();
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Processing limits must be positive integers.');
  return Math.min(value, maximum);
}

function normalizeOptions(options: CategorizationOptions): CategorizationOptions {
  if (options.maxJournalId !== undefined && (!Number.isSafeInteger(options.maxJournalId) || options.maxJournalId < 0)) {
    throw new Error('The processing snapshot must be a valid journal ID.');
  }
  for (const ids of [options.journalIds, options.syncRunIds]) {
    if (ids !== undefined && (ids.length > 10000 || ids.some(id => !Number.isSafeInteger(id) || id <= 0))) {
      throw new Error('Select up to 10,000 valid journal or sync IDs.');
    }
  }
  return {
    ...options,
    journalIds: options.journalIds === undefined ? undefined : [...new Set(options.journalIds)],
    syncRunIds: options.syncRunIds === undefined ? undefined : [...new Set(options.syncRunIds)],
    limit: bounded(options.limit, MAX_PROCESSING_ENTRIES, MAX_PROCESSING_ENTRIES),
    deadlineMs: bounded(options.deadlineMs, 45000, 45000),
    modelTimeoutMs: bounded(options.modelTimeoutMs, 20000, 30000),
  };
}

/** An AI spending label cannot establish a sender or reconcile an account. */
function essentialContextReason(candidate: CategorizationCandidate): string | null {
  const movement = movementReviewReason(candidate);
  if (movement) return movement;
  if (hasMovementDescription(candidate)) return 'The statement describes a payment or account movement. Identify its purpose or destination before counting it as ordinary spending.';
  if (isFinancialOrBarePaymentProvider(candidate)) return 'Identify the destination or underlying payment before counting this financial service or payment-provider entry as spending.';
  const financial = candidate.legs.find(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  const incoming = financial?.accountType === 'ASSET' && Number(financial.amount) > 0;
  const incomeHint = `${candidate.bankCategory ?? ''} ${candidate.transactionType ?? ''}`.replace(/[_-]/g, ' ');
  if (incoming && !/\b(?:salary|payroll|wages|dividends?|interest paid|pension income)\b/i.test(incomeHint)) {
    return 'Identify who sent this payment and why. It could be income, a reimbursement or a movement between accounts; an incoming amount alone does not establish income.';
  }
  return null;
}

function canReassessSpending(candidate: CategorizationCandidate): boolean {
  if (candidate.propertyId !== null || essentialContextReason(candidate)) return false;
  const financial = candidate.legs.find(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  if (!financial || Number(financial.amount) >= 0) return false;
  const type = (candidate.transactionType ?? '').replace(/[_-]/g, ' ').trim();
  return /^(?:(?:(?:debit|credit) )?card(?: payment| purchase| transaction)?|pos(?: payment| purchase)?|point of sale(?: payment| purchase)?)$/i.test(type)
    || merchantResearchInputFromCandidate(candidate) !== null;
}

/**
 * One bounded, leased pass. Only known high-confidence decisions are applied;
 * uncertainty is a durable review item rather than a guessed category.
 * Model failures are reported without discarding deterministic successes.
 */
export async function processCategorization(options: CategorizationOptions = {}): Promise<CategorizationResult> {
  const normalized = normalizeOptions(options);
  const startedAt = Date.now();
  const deadline = startedAt + normalized.deadlineMs!;
  const token = randomUUID();
  const counters = {
    total: 0, ruleBased: 0, aiCategorized: 0, learned: 0, aiNoMatch: 0,
    reviewQueued: 0, reviewsRechecked: 0, conflicts: 0, batches: 0,
  };
  let aiSkippedReason: string | null = null;
  let deferredReason: CategorizationResult['deferredReason'] = null;
  const acquired = await categorizationRepo.acquireLease(token);
  if (!acquired) {
    const counts = await categorizationRepo.counts(normalized);
    return {
      ...counts, ...counters, hasMore: counts.scopeAvailable > 0, busy: true,
      status: 'partial', aiSkippedReason: 'Another data-processing pass is already running.', reviewUrl: '/data', deferredReason: 'busy',
    };
  }

  try {
    const [candidates, categories, rules] = await Promise.all([
      categorizationRepo.listCandidates(normalized), categoryRepo.listAll(), categoryRepo.getRules(),
    ]);
    counters.total = candidates.length;
    const [learned, payeeMemories] = await Promise.all([
      categorizationRepo.lookupLearned(candidates.map(categorizationContextKey)),
      loadActivePayeeMemories(candidates),
    ]);
    const validCategories = new Set(categories.map(category => category.id));
    const deterministic: CategorizationDecision[] = [];
    const policyChecks: CategorizationCandidate[] = [];
    const unmatched: CategorizationCandidate[] = [];
    for (const candidate of candidates) {
      const learnedCategoryId = learned.get(categorizationContextKey(candidate));
      const payeeMatches = matchingConfirmedPayees(candidate, payeeMemories, categories);
      const payeeMatch = payeeMatches[0];
      const validLearned = learnedCategoryId !== undefined && validCategories.has(learnedCategoryId);
      if (payeeMatch) {
        const multipleMeanings = payeeMatches.length > 1;
        const mappingConflict = validLearned && learnedCategoryId !== payeeMatch.memory.categoryId;
        const reviewReason = multipleMeanings ? PAYEE_MEANINGS_CONFLICT_REASON : mappingConflict
          ? 'Your saved exact match and private payee meaning disagree. Confirm the category and update the conflicting knowledge.'
          : confirmedContextReviewReason(candidate, payeeMatch.memory.categoryId, categories);
        deterministic.push({
          journalId: candidate.id, categoryId: mappingConflict || multipleMeanings ? null : payeeMatch.memory.categoryId,
          confidence: 1, source: 'payee', status: reviewReason ? 'needs_review' : 'applied',
          reason: reviewReason ?? 'Matches private payee knowledge you confirmed for this account, direction and property context.',
          payeeMemoryId: payeeMatch.memory.id, payeeMemoryRevision: payeeMatch.memory.revision,
        });
      } else if (validLearned) {
        const reviewReason = confirmedContextReviewReason(candidate, learnedCategoryId, categories);
        deterministic.push({
          journalId: candidate.id, categoryId: learnedCategoryId, confidence: 1, source: 'learned',
          status: reviewReason ? 'needs_review' : 'applied',
          reason: reviewReason ?? 'Matches an exact transaction context previously confirmed by you.',
        });
      } else {
        const rule = ruleDecision(candidate, rules, categories);
        const service = !rule ? knownServiceMatch(candidate, categories) : null;
        const serviceReason = service ? movementReviewReason(candidate, service.categoryId, categories) : null;
        if (rule && (!candidate.pendingReview || rule.status === 'applied')) deterministic.push(rule);
        else if (service && !serviceReason) deterministic.push({
          journalId: candidate.id, categoryId: service.categoryId, confidence: 1, reason: service.reason, source: 'rule', status: 'applied',
        });
        else if (candidate.pendingReview) {
          // One new policy pass can research old spending. A raced confirmed
          // lookup must not reopen a policy-current question indefinitely.
          if (candidate.policyReassessment && canReassessSpending(candidate)) unmatched.push(candidate);
          else policyChecks.push(candidate);
        } else {
          const essential = essentialContextReason(candidate);
          if (essential) deterministic.push({ journalId: candidate.id, categoryId: null, confidence: 0,
            reason: essential, source: 'ai', status: 'needs_review' });
          else unmatched.push(candidate);
        }
      }
    }

    async function persist(decisions: CategorizationDecision[]) {
      if (!decisions.length) return;
      const persisted = await categorizationRepo.persistDecisions(candidates, decisions, token);
      const decisionById = new Map(decisions.map(decision => [decision.journalId, decision]));
      counters.conflicts += decisions.length - persisted.length;
      for (const row of persisted) {
        const decision = decisionById.get(row.journalId)!;
        if (row.status === 'needs_review') {
          if (candidates.find(candidate => candidate.id === row.journalId)?.pendingReview) counters.reviewsRechecked++;
          else counters.reviewQueued++;
          if (decision.source === 'ai') counters.aiNoMatch++;
        } else if (decision.source === 'rule') {
          counters.ruleBased++;
        } else if (decision.source === 'learned' || decision.source === 'payee') {
          counters.learned++;
        } else {
          counters.aiCategorized++;
        }
      }
    }

    if (Date.now() < deadline) {
      await persist(deterministic);
      // A failed/unconfirmed deterministic save must never be hidden behind a
      // policy stamp. Unresolved reviews retain their exact original evidence.
      if (policyChecks.length && counters.conflicts === 0 && Date.now() < deadline) {
        const checked = await categorizationRepo.markReviewPolicyChecked(policyChecks, token);
        counters.reviewsRechecked += checked.length;
        counters.conflicts += policyChecks.length - checked.length;
      }
    }
    else if (candidates.length) {
      aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
      deferredReason = 'time_budget';
    }

    if (unmatched.length > 0 && !aiSkippedReason) {
      if (!process.env.AI_GATEWAY_API_KEY) {
        aiSkippedReason = 'AI categorisation is unavailable because the AI service is not configured.';
        deferredReason = 'model_unavailable';
      } else if (!categories.length) {
        aiSkippedReason = 'Add spending categories before running AI categorisation.';
        deferredReason = 'no_categories';
      } else {
        // Leave a short window for the final atomic save, counts and lease
        // release inside the overall budget and the database's 60-second lease.
        const persistenceMargin = Math.min(1_000, Math.ceil(normalized.deadlineMs! / 10));
        let modelBudgetMs = normalized.modelTimeoutMs!;
        let researchBudgetMs = RESEARCH_TIMEOUT_MS;
        const attemptedResearch = new Set<string>();
        const merchantEvidence = new Map<string, MerchantResearchResult>();
        let privateNames: readonly string[] | undefined;
        let ownerLookupFailed = false;
        const remainingModelMs = () => Math.min(modelBudgetMs, deadline - persistenceMargin - Date.now());

        // Local private identities apply to every automatic result, including
        // confident results which never need a public merchant lookup.
        const privateLookupStarted = Date.now();
        try {
          const [owners, payeeNames] = await boundedOperation(() => Promise.all([
            propertyRepo.listOwners(), loadPrivatePayeeNames(),
          ]), Math.max(1, Math.min(350, remainingModelMs())));
          privateNames = [...owners.map(owner => owner.name), ...payeeNames];
        } catch { ownerLookupFailed = true; }
        finally { researchBudgetMs -= Math.max(0, Date.now() - privateLookupStarted); }

        async function classify(batch: CategorizationCandidate[], evidence?: ReadonlyMap<number, MerchantResearchResult>) {
          const remainingMs = remainingModelMs();
          if (remainingMs <= 0) throw new CategorizationBatchTimeoutError();
          const modelStartedAt = Date.now();
          try {
            counters.batches++;
            const response = await boundedOperation(
              signal => categorizeContextBatch(batch, categories, signal, evidence),
              Math.min(MODEL_ATTEMPT_TIMEOUT_MS, remainingMs),
            );
            return validateModelDecisions(response, batch, categories, evidence);
          } finally {
            // Merchant research has its own small budget; count model time
            // rather than consuming that model allowance while researching.
            modelBudgetMs -= Math.max(0, Date.now() - modelStartedAt);
          }
        }

        async function enrichAmbiguous(
          batch: CategorizationCandidate[], decisions: CategorizationDecision[],
        ): Promise<CategorizationDecision[]> {
          if (remainingModelMs() < MIN_RETRY_BUDGET_MS) return decisions;
          const decisionById = new Map(decisions.map(decision => [decision.journalId, decision]));
          const ambiguous = batch.filter(candidate => {
            const decision = decisionById.get(candidate.id)!;
            const local = !ownerLookupFailed ? assessAutomaticSpending(candidate, categories, decision, { privateNames }) : null;
            // Research the unresolved business identity, not an already useful
            // bank-supported label or a broad retail classification.
            if (local && local.assignmentKind !== 'broad') return false;
            return decision.status === 'needs_review' && !needsMovementReview(candidate, decision.categoryId, categories)
              && merchantResearchInputFromCandidate(candidate) !== null;
          });
          if (!ambiguous.length || ownerLookupFailed) return decisions;
          if (privateNames === undefined) {
            const timeoutMs = Math.min(350, researchBudgetMs, deadline - persistenceMargin - Date.now() - MIN_RETRY_BUDGET_MS);
            if (timeoutMs <= 0) return decisions;
            const lookupStartedAt = Date.now();
            try {
              const [owners, payeeNames] = await boundedOperation(() => Promise.all([
                propertyRepo.listOwners(), loadPrivatePayeeNames(),
              ]), timeoutMs);
              privateNames = [...owners.map(owner => owner.name), ...payeeNames];
            } catch {
              // Fail closed when the local private-name exclusion list cannot
              // be read; categorisation from local transaction context still works.
              ownerLookupFailed = true;
              return decisions;
            } finally {
              researchBudgetMs -= Math.max(0, Date.now() - lookupStartedAt);
            }
          }
          const eligible = ambiguous.flatMap(candidate => {
            // The helper accepts structured merchant metadata or a narrowly
            // cleaned explicit-card descriptor, never a general journal memo.
            const input = merchantResearchInputFromCandidate(candidate, privateNames);
            if (!input) return [];
            const query = buildMerchantResearchQuery(input);
            return query ? [{ candidate, input, query }] : [];
          });
          const lookups = new Map<string, typeof eligible[number]>();
          for (const entry of eligible) {
            if (!attemptedResearch.has(entry.query.cacheKey) && attemptedResearch.size < MAX_RESEARCH_QUERIES) {
              attemptedResearch.add(entry.query.cacheKey);
              lookups.set(entry.query.cacheKey, entry);
            }
          }
          const timeoutMs = Math.min(researchBudgetMs, deadline - persistenceMargin - Date.now() - MIN_RETRY_BUDGET_MS);
          if (lookups.size && timeoutMs > 0) {
            const researchStartedAt = Date.now();
            await Promise.all([...lookups].map(async ([key, entry]) => {
              try {
                const result = await boundedOperation(
                  signal => researchMerchant(entry.input, { signal, timeoutMs }), timeoutMs,
                );
                const evidence = validateMerchantResearchResult(result);
                if (evidence?.status === 'matched' && evidence.sources.length
                  && evidence.query?.toLocaleLowerCase('en-GB') === entry.query.query.toLocaleLowerCase('en-GB')) {
                  merchantEvidence.set(key, evidence);
                }
              } catch {
                // Research is optional enrichment. Keep the valid local
                // decision if the research provider or its cache is unavailable.
              }
            }));
            researchBudgetMs -= Math.max(0, Date.now() - researchStartedAt);
          }
          const evidenceById = new Map<number, MerchantResearchResult>();
          const researched = eligible.flatMap(entry => {
            const evidence = merchantEvidence.get(entry.query.cacheKey);
            if (!evidence) return [];
            evidenceById.set(entry.candidate.id, evidence);
            return [entry.candidate];
          });
          if (!researched.length || remainingModelMs() < MIN_RETRY_BUDGET_MS) return decisions;
          try {
            const enriched = await classify(researched, evidenceById);
            const enrichedById = new Map(enriched.map(decision => [decision.journalId, decision]));
            return decisions.map(decision => enrichedById.get(decision.journalId) ?? decision);
          } catch {
            console.warn('[categorization] enriched model batch unavailable or invalid', { batchSize: researched.length });
            return decisions;
          }
        }

        let batchSize = INITIAL_MODEL_BATCH_SIZE;
        let offset = 0;
        while (offset < unmatched.length) {
          const remainingMs = remainingModelMs();
          if (remainingMs <= 0) {
            aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
            deferredReason = 'time_budget';
            break;
          }
          const batch = unmatched.slice(offset, offset + batchSize);
          let decisions: CategorizationDecision[];
          try {
            decisions = await classify(batch);
          } catch (error) {
            // Provider messages can contain echoed financial data; never log
            // response bodies, prompts or raw provider errors here.
            console.warn('[categorization] model batch unavailable or invalid', { batchSize: batch.length });
            const timedOut = error instanceof CategorizationBatchTimeoutError || remainingModelMs() <= 0;
            if (timedOut && batch.length > 1 && remainingModelMs() >= MIN_RETRY_BUDGET_MS) {
              // One smaller retry can make durable progress when a batch is
              // too slow. A single-row timeout stops; never retry indefinitely
              // or turn untouched entries into fabricated review decisions.
              batchSize = 1;
              continue;
            }
            deferredReason = timedOut ? 'time_budget' : 'model_failed';
            aiSkippedReason = deferredReason === 'time_budget'
              ? 'The processing time budget was reached. Run another pass to continue.'
              : 'AI categorisation could not finish this batch. No model changes were applied for it; run another pass to retry.';
            break;
          }
          decisions = await enrichAmbiguous(batch, decisions);
          decisions = decisions.map(decision => {
            const candidate = batch.find(candidate => candidate.id === decision.journalId)!;
            const essential = essentialContextReason(candidate);
            if (essential) return { ...decision, categoryId: null, status: 'needs_review' as const, reason: essential };
            const financial = candidate.legs.find(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
            if (candidate.propertyId === null && Number(financial?.amount) < 0 && decision.categoryId !== null
              && isProtectedSpendingCategory(decision.categoryId, categories)) {
              return { ...decision, categoryId: null, status: 'needs_review' as const,
                reason: 'A spending label cannot establish income, a financial-account movement, property use or tax treatment. More account or payment context is needed.' };
            }
            const identity = `${candidate.merchantName ?? ''} ${candidate.description}`.normalize('NFKC').toLocaleLowerCase('en-GB').replace(/\s+/g, ' ');
            if (privateNames?.some(name => { const value = name.normalize('NFKC').toLocaleLowerCase('en-GB').replace(/\s+/g, ' ').trim(); return value.length >= 3 && identity.includes(value); })) {
              return { ...decision, categoryId: null, status: 'needs_review' as const,
                reason: 'This matches a private payment identity. Confirm its purpose in this account context once so future payments can use the saved meaning.' };
            }
            const assessment = ownerLookupFailed ? null : assessAutomaticSpending(candidate, categories, decision, { research: decision.evidence, privateNames });
            return assessment && !movementReviewReason(candidate, assessment.categoryId, categories)
              ? { ...decision, ...assessment, status: 'applied' as const }
              : decision;
          });
          if (Date.now() >= deadline) {
            aiSkippedReason = 'The processing time budget was reached. Run another pass to continue.';
            deferredReason = 'time_budget';
            break;
          }
          // Database errors must propagate: claiming a model failure would
          // hide a failed save and misrepresent which decisions persisted.
          await persist(decisions);
          offset += batch.length;
        }
      }
    }

    const counts = await categorizationRepo.counts(normalized);
    const changed = counters.ruleBased + counters.aiCategorized + counters.learned + counters.reviewQueued + counters.reviewsRechecked;
    return {
      ...counts, ...counters, aiSkippedReason, deferredReason, hasMore: counts.scopeAvailable > 0,
      busy: false, status: aiSkippedReason ? (changed ? 'partial' : 'unavailable') : (counts.scopeAvailable > 0 ? 'partial' : 'complete'),
      reviewUrl: '/data',
    };
  } finally {
    await categorizationRepo.releaseLease(token);
  }
}
