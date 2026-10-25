import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { londonTodayIso } from '@/lib/dates/today';
import { parseMerchantResearchEvidence } from '@/lib/merchant-research/schema';
import { categorizationContextKey, PAYEE_MEANINGS_CONFLICT_REASON, REVIEW_POLICY_VERSION } from './decisions';
import { payeeCandidateMatchSql, payeeSourceValiditySql } from './payees/sql';
import type { CategorizationCandidate, CategorizationDecision, CategorizationOptions } from './types';

/**
 * One canonical database fingerprint shared by automatic writes and review.
 * Account ownership, metadata and every book leg are included so changed
 * context invalidates an in-flight decision without changing the ledger.
 */
export function candidateSnapshotSql(alias = 'je'): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error('Invalid journal SQL alias');
  const journal = sql.raw(alias);
  return sql`md5(jsonb_build_array(
    ${journal}.date, ${journal}.description, ${journal}.reference, ${journal}.property_id, ${journal}.category_id,
    (SELECT jsonb_build_array(tm.merchant_name, tm.bank_category, tm.transaction_type, tm.currency)
       FROM transaction_metadata tm WHERE tm.journal_entry_id = ${journal}.id),
    COALESCE((SELECT jsonb_agg(jsonb_build_array(be.id, be.account_id, be.amount::text,
                      a.name, a.account_type, a.owner_id) ORDER BY be.id)
       FROM book_entries be JOIN accounts a ON a.id = be.account_id
      WHERE be.journal_entry_id = ${journal}.id), '[]'::jsonb)
  )::text)`;
}

/** Income/expense postings only; opening balances and valuations are equity. */
export function candidateEligibilitySql(alias = 'je', asOf = londonTodayIso()): SQL {
  if (!/^[a-z][a-z0-9_]*$/.test(alias)) throw new Error('Invalid journal SQL alias');
  const journal = sql.raw(alias);
  return sql`${journal}.category_id IS NULL
    AND COALESCE(${journal}.is_transfer, FALSE) = FALSE
    AND ${journal}.transfer_group_id IS NULL
    AND ${journal}.transfer_partner_journal_id IS NULL
    AND ${journal}.date <= ${asOf}
    AND EXISTS (SELECT 1 FROM book_entries eligibility_be
      JOIN accounts eligibility_a ON eligibility_a.id = eligibility_be.account_id
      WHERE eligibility_be.journal_entry_id = ${journal}.id
        AND eligibility_a.account_type IN ('INCOME', 'EXPENSE'))`;
}

function scopeSql(options: CategorizationOptions): SQL {
  const clauses: SQL[] = [];
  if (options.maxJournalId !== undefined) clauses.push(sql`je.id <= ${options.maxJournalId}`);
  if (options.journalIds !== undefined) {
    clauses.push(sql`je.id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(options.journalIds)}::jsonb))`);
  }
  if (options.syncRunIds !== undefined) {
    clauses.push(sql`je.sync_run_id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(options.syncRunIds)}::jsonb))`);
  }
  return clauses.length ? sql.join(clauses, sql` AND `) : sql`TRUE`;
}

const refreshedConfirmation = sql`EXISTS (
  SELECT 1 FROM categorization_learning learning WHERE learning.context_key = tc.context_key
    AND tc.status = 'needs_review'
    AND (tc.source NOT IN ('learned', 'payee')
      OR (tc.source = 'learned' AND tc.category_id IS DISTINCT FROM learning.category_id)
      OR learning.updated_at > tc.updated_at
      OR (tc.source = 'learned' AND tc.reason = 'The bank metadata describes an account movement. Confirm whether it is spending, income or a transfer before categorising it.'
        AND lower(btrim(regexp_replace(COALESCE((SELECT transaction_type FROM transaction_metadata WHERE journal_entry_id = je.id), ''), '[_-]+', ' ', 'g'))) = 'bank transfer'))
) OR EXISTS (
  SELECT 1 FROM categorization_payee_memories pm
  WHERE tc.status = 'needs_review' AND ${payeeCandidateMatchSql()} AND ${payeeSourceValiditySql()}
    AND (SELECT count(*) FROM categorization_payee_memories candidate_pm
      WHERE ${payeeCandidateMatchSql('candidate_pm')} AND ${payeeSourceValiditySql('candidate_pm')}) = 1
    AND (tc.payee_memory_id IS DISTINCT FROM pm.id OR tc.payee_memory_revision IS DISTINCT FROM pm.revision
      OR tc.reason = ${PAYEE_MEANINGS_CONFLICT_REASON})
)`;

const noCurrentDecision = sql`NOT EXISTS (
  SELECT 1 FROM transaction_categorizations tc
   WHERE tc.journal_entry_id = je.id
     AND (tc.status IN ('reviewed', 'dismissed', 'applied') OR (
       tc.snapshot_hash = ${candidateSnapshotSql()} AND NOT (${refreshedConfirmation})
         AND NOT (tc.status = 'needs_review' AND tc.review_policy_version IS DISTINCT FROM ${REVIEW_POLICY_VERSION})
     ))
)`;

export const categorizationRepo = {
  async acquireLease(token: string, seconds = 60): Promise<boolean> {
    const rows = await getDb().execute(sql`
      INSERT INTO categorization_processing_lease (id, token, expires_at, updated_at)
      VALUES (1, ${token}::uuid, now() + make_interval(secs => ${seconds}), now())
      ON CONFLICT (id) DO UPDATE SET token = EXCLUDED.token,
        expires_at = EXCLUDED.expires_at, updated_at = now()
      WHERE categorization_processing_lease.expires_at <= now()
      RETURNING id
    `);
    return rows.rows.length === 1;
  },

  async releaseLease(token: string): Promise<void> {
    await getDb().execute(sql`DELETE FROM categorization_processing_lease WHERE id = 1 AND token = ${token}::uuid`);
  },

  async listCandidates(options: CategorizationOptions = {}): Promise<CategorizationCandidate[]> {
    const limit = Math.min(100, Math.max(1, options.limit ?? 100));
    const rows = await getDb().execute(sql`
      SELECT je.id, je.date, je.description, je.property_id AS "propertyId",
        (tc.status = 'needs_review' AND tc.snapshot_hash = ${candidateSnapshotSql()}) AS "pendingReview",
        tm.merchant_name AS "merchantName", tm.bank_category AS "bankCategory",
        tm.transaction_type AS "transactionType", tm.currency,
        ${candidateSnapshotSql()} AS snapshot,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('accountId', a.id, 'accountName', a.name,
          'accountType', a.account_type, 'ownerId', a.owner_id, 'amount', be.amount::text) ORDER BY be.id)
          FROM book_entries be JOIN accounts a ON a.id = be.account_id
          WHERE be.journal_entry_id = je.id), '[]'::jsonb) AS legs
      FROM journal_entries je
      LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
      LEFT JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
      WHERE ${candidateEligibilitySql()} AND ${scopeSql(options)} AND ${noCurrentDecision}
      ORDER BY je.date DESC, je.id DESC LIMIT ${limit}
    `);
    return rows.rows as CategorizationCandidate[];
  },

  async getCandidatesByIds(ids: number[], includeCategorized = true): Promise<Array<CategorizationCandidate & {
    categoryId: number | null; isTransfer: boolean; transferGroupId: string | null;
  }>> {
    if (!ids.length) return [];
    if (ids.length > 100 || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('Select up to 100 valid journal IDs.');
    const rows = await getDb().execute(sql`
      SELECT je.id, je.date, je.description, je.property_id AS "propertyId", je.category_id AS "categoryId",
        je.is_transfer AS "isTransfer", je.transfer_group_id::text AS "transferGroupId",
        tm.merchant_name AS "merchantName", tm.bank_category AS "bankCategory",
        tm.transaction_type AS "transactionType", tm.currency,
        ${candidateSnapshotSql()} AS snapshot,
        COALESCE((SELECT jsonb_agg(jsonb_build_object('accountId', a.id, 'accountName', a.name,
          'accountType', a.account_type, 'ownerId', a.owner_id, 'amount', be.amount::text) ORDER BY be.id)
          FROM book_entries be JOIN accounts a ON a.id = be.account_id
          WHERE be.journal_entry_id = je.id), '[]'::jsonb) AS legs
      FROM journal_entries je
      LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
      WHERE je.id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
        AND (${includeCategorized} OR je.category_id IS NULL)
      ORDER BY je.id
    `);
    return rows.rows as Array<CategorizationCandidate & { categoryId: number | null; isTransfer: boolean; transferGroupId: string | null }>;
  },

  async counts(options: CategorizationOptions & { asOf?: string } = {}) {
    const rows = await getDb().execute(sql`
      SELECT COUNT(*)::integer AS remaining,
        COUNT(*) FILTER (WHERE tc.status = 'needs_review' AND tc.snapshot_hash = ${candidateSnapshotSql()})::integer AS "needsReview",
        COUNT(*) FILTER (WHERE tc.status = 'dismissed')::integer AS dismissed,
        COUNT(*) FILTER (WHERE ${noCurrentDecision})::integer AS available,
        COUNT(*) FILTER (WHERE ${noCurrentDecision} AND ${scopeSql(options)})::integer AS "scopeAvailable"
      FROM journal_entries je
      LEFT JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
      WHERE ${candidateEligibilitySql('je', options.asOf)}
    `);
    const row = rows.rows[0] as { remaining: number; needsReview: number; dismissed: number; available: number; scopeAvailable: number };
    return row;
  },

  async lookupLearned(keys: string[]): Promise<Map<string, number>> {
    if (!keys.length) return new Map();
    const rows = await getDb().execute(sql`
      SELECT context_key, category_id FROM categorization_learning
      WHERE context_key IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(keys)}::jsonb))
    `);
    return new Map(rows.rows.map(row => [row.context_key as string, row.category_id as number]));
  },

  /** A policy check keeps the original question, evidence and review revision. */
  async markReviewPolicyChecked(candidates: CategorizationCandidate[], leaseToken: string): Promise<number[]> {
    if (!candidates.length) return [];
    const payload = candidates.map(candidate => ({ journalId: candidate.id, snapshot: candidate.snapshot }));
    const rows = await getDb().execute(sql`WITH proposed AS (
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb) AS p("journalId" integer, snapshot text)
    ), locked AS MATERIALIZED (
      SELECT je.id, p.snapshot FROM journal_entries je JOIN proposed p ON p."journalId" = je.id
      WHERE ${candidateEligibilitySql()} AND ${candidateSnapshotSql()} = p.snapshot
        AND EXISTS (SELECT 1 FROM categorization_processing_lease lease
          WHERE lease.id = 1 AND lease.token = ${leaseToken}::uuid AND lease.expires_at > now())
      ORDER BY je.id FOR UPDATE OF je
    ) UPDATE transaction_categorizations tc SET review_policy_version = ${REVIEW_POLICY_VERSION}
      FROM locked WHERE tc.journal_entry_id = locked.id AND tc.snapshot_hash = locked.snapshot
        AND tc.status = 'needs_review' AND tc.review_policy_version IS DISTINCT FROM ${REVIEW_POLICY_VERSION}
      RETURNING tc.journal_entry_id AS "journalId"`);
    return rows.rows.map(row => Number(row.journalId));
  },

  /** Journal locking + snapshot check + provenance + category in one statement. */
  async persistDecisions(
    candidates: CategorizationCandidate[], decisions: CategorizationDecision[], leaseToken?: string,
  ): Promise<Array<{ journalId: number; status: 'applied' | 'needs_review' }>> {
    if (!decisions.length) return [];
    const candidateById = new Map(candidates.map(candidate => [candidate.id, candidate]));
    const payload = decisions.map(decision => {
      const candidate = candidateById.get(decision.journalId);
      if (!candidate) throw new Error('A categorisation decision is outside the selected batch.');
      if (decision.status === 'applied' && decision.categoryId === null) throw new Error('An applied category must be known.');
      const evidence = decision.evidence === undefined ? null : parseMerchantResearchEvidence(decision.evidence);
      if (decision.evidence !== undefined && (!evidence || decision.source !== 'ai')) {
        throw new Error('Categorisation evidence must contain actual public merchant sources.');
      }
      if (decision.source === 'payee') {
        if (!z.uuid().safeParse(decision.payeeMemoryId).success
          || !Number.isSafeInteger(decision.payeeMemoryRevision) || decision.payeeMemoryRevision! <= 0) {
          throw new Error('A private payee decision needs its current confirmed memory revision.');
        }
      } else if (decision.payeeMemoryId !== undefined || decision.payeeMemoryRevision !== undefined) {
        throw new Error('Private payee provenance belongs only to confirmed payee decisions.');
      }
      return { ...decision, evidence, payeeMemoryId: decision.payeeMemoryId ?? null,
        payeeMemoryRevision: decision.payeeMemoryRevision ?? null,
        snapshot: candidate.snapshot, contextKey: categorizationContextKey(candidate) };
    });
    const rows = await getDb().execute(sql`
      WITH proposed AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(payload)}::jsonb)
        AS p("journalId" integer, "categoryId" integer, confidence numeric,
          reason text, source text, status text, snapshot text, "contextKey" text, evidence jsonb,
          "payeeMemoryId" uuid, "payeeMemoryRevision" integer)
      ), locked AS MATERIALIZED (
        SELECT je.id, p.* FROM journal_entries je JOIN proposed p ON p."journalId" = je.id
        WHERE ${candidateEligibilitySql()}
          AND (${leaseToken === undefined} OR EXISTS (SELECT 1 FROM categorization_processing_lease lease
            WHERE lease.id = 1 AND lease.token = ${leaseToken ?? null}::uuid AND lease.expires_at > now()))
          AND ${candidateSnapshotSql()} = p.snapshot
          AND ${noCurrentDecision}
          AND (p.source <> 'learned' OR EXISTS (SELECT 1 FROM categorization_learning learning
            WHERE learning.context_key = p."contextKey" AND learning.category_id = p."categoryId"))
          AND NOT EXISTS (SELECT 1 FROM transaction_categorizations current_decision
            WHERE current_decision.journal_entry_id = je.id AND current_decision.snapshot_hash = p.snapshot
              AND ((p.source NOT IN ('learned', 'payee') AND NOT (p.source = 'rule' AND p.status = 'applied'
                AND current_decision.status = 'needs_review' AND current_decision.review_policy_version IS DISTINCT FROM ${REVIEW_POLICY_VERSION}))
                OR current_decision.context_key <> p."contextKey"))
          AND (p."categoryId" IS NULL OR EXISTS (SELECT 1 FROM categories c WHERE c.id = p."categoryId"))
        ORDER BY je.id FOR UPDATE OF je
      ), locked_payee_sources AS MATERIALIZED (
        SELECT sj.id FROM journal_entries sj
        JOIN categorization_payee_memories pm ON pm.source_journal_id = sj.id
        JOIN locked p ON p.source = 'payee' AND p."payeeMemoryId" = pm.id AND p."payeeMemoryRevision" = pm.revision
        ORDER BY sj.id FOR UPDATE OF sj
      ), confirmed_payees AS MATERIALIZED (
        SELECT pm.id, pm.revision, pm.category_id FROM categorization_payee_memories pm
        JOIN locked_payee_sources sj ON sj.id = pm.source_journal_id
        JOIN locked p ON p.source = 'payee' AND p."payeeMemoryId" = pm.id AND p."payeeMemoryRevision" = pm.revision
        JOIN journal_entries je ON je.id = p.id
        WHERE pm.status = 'active' AND (p."categoryId" IS NULL OR pm.category_id = p."categoryId")
          AND ${payeeCandidateMatchSql()} AND ${payeeSourceValiditySql()}
        ORDER BY pm.id FOR UPDATE OF pm
      ), stored AS (
        INSERT INTO transaction_categorizations (journal_entry_id, snapshot_hash, context_key,
          category_id, confidence, reason, source, status, evidence, payee_memory_id, payee_memory_revision, review_policy_version, created_at, updated_at)
        SELECT id, snapshot, "contextKey", "categoryId", confidence, reason, source, status, evidence,
          "payeeMemoryId", "payeeMemoryRevision", ${REVIEW_POLICY_VERSION}, now(), now()
          FROM locked p WHERE p.source <> 'payee' OR EXISTS (SELECT 1 FROM confirmed_payees cp
            WHERE cp.id = p."payeeMemoryId" AND cp.revision = p."payeeMemoryRevision")
        ON CONFLICT (journal_entry_id) DO UPDATE SET snapshot_hash = EXCLUDED.snapshot_hash,
          context_key = EXCLUDED.context_key, category_id = EXCLUDED.category_id,
          confidence = EXCLUDED.confidence, reason = EXCLUDED.reason, source = EXCLUDED.source,
          status = EXCLUDED.status, evidence = EXCLUDED.evidence,
          payee_memory_id = EXCLUDED.payee_memory_id, payee_memory_revision = EXCLUDED.payee_memory_revision,
          review_policy_version = EXCLUDED.review_policy_version, updated_at = now()
        WHERE transaction_categorizations.status = 'needs_review'
          AND (transaction_categorizations.snapshot_hash <> EXCLUDED.snapshot_hash OR (
            EXCLUDED.source = 'learned' AND transaction_categorizations.context_key = EXCLUDED.context_key
            AND EXISTS (SELECT 1 FROM categorization_learning learning
              WHERE learning.context_key = EXCLUDED.context_key AND learning.category_id = EXCLUDED.category_id)
          ) OR (
            EXCLUDED.source = 'payee' AND transaction_categorizations.context_key = EXCLUDED.context_key
            AND EXISTS (SELECT 1 FROM confirmed_payees cp WHERE cp.id = EXCLUDED.payee_memory_id AND cp.revision = EXCLUDED.payee_memory_revision)
          ) OR (
            EXCLUDED.source = 'rule' AND EXCLUDED.status = 'applied'
            AND transaction_categorizations.context_key = EXCLUDED.context_key
            AND transaction_categorizations.review_policy_version IS DISTINCT FROM ${REVIEW_POLICY_VERSION}
          ))
        RETURNING journal_entry_id, status, category_id
      ), updated AS (
        UPDATE journal_entries je SET category_id = stored.category_id FROM stored
        WHERE je.id = stored.journal_entry_id AND stored.status = 'applied'
        RETURNING je.id
      )
      SELECT stored.journal_entry_id AS "journalId", stored.status
      FROM stored WHERE stored.status = 'needs_review'
        OR EXISTS (SELECT 1 FROM updated WHERE updated.id = stored.journal_entry_id)
    `);
    return rows.rows as Array<{ journalId: number; status: 'applied' | 'needs_review' }>;
  },
};
