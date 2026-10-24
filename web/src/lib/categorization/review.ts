import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { parseMerchantResearchEvidence } from '@/lib/merchant-research/schema';
import type { MerchantResearchResult } from '@/lib/merchant-research/types';
import { payeeCandidateMatchSql } from './payees/sql';
import { categorizationContextKey } from './decisions';
import { candidateEligibilitySql, candidateSnapshotSql } from './repository';
import type { CategorizationCandidate, CategorizationLeg } from './types';

export interface CategorizationRecord {
  journalId: number;
  date: string;
  description: string;
  merchantName: string | null;
  bankCategory: string | null;
  transactionType: string | null;
  currency: string | null;
  propertyId: number | null;
  legs: CategorizationLeg[];
  categoryId: number | null;
  snapshot: string;
  isTransfer: boolean;
  pendingTransfer: boolean;
}

export interface ReviewItem {
  journalId: number;
  date: string;
  description: string;
  merchantName: string | null;
  currency: string | null;
  propertyId: number | null;
  legs: CategorizationLeg[];
  suggestedCategoryId: number | null;
  suggestedCategoryName: string | null;
  confidence: number | null;
  reason: string;
  evidence: MerchantResearchResult | null;
  snapshot: string;
  updatedAt: string;
}

export interface ReviewQueue {
  items: ReviewItem[];
  total: number;
  nextCursor: number | null;
  categories: Array<{ id: number; name: string; parentId: number | null }>;
}

export class CategorizationConflictError extends Error {
  constructor() { super('This transaction changed or was already reviewed. Reload its latest details before applying your choice.'); }
}
export class InvalidCategorizationError extends Error {}

const snapshotSchema = z.string().regex(/^[a-f0-9]{32}$/);
export const reviewDecisionSchema = z.object({
  journalId: z.number().int().positive(),
  snapshot: snapshotSchema,
  action: z.enum(['accept', 'correct', 'dismiss']),
  categoryId: z.number().int().positive().optional(),
  remember: z.boolean().default(false),
}).strict().superRefine((value, context) => {
  if (value.action === 'correct' && value.categoryId === undefined) context.addIssue({ code: 'custom', message: 'Choose a category to correct this transaction.' });
  if (value.action === 'dismiss' && (value.remember || value.categoryId !== undefined)) context.addIssue({ code: 'custom', message: 'A dismissed suggestion cannot create a category mapping.' });
});
export type ReviewDecision = z.infer<typeof reviewDecisionSchema>;

const recordLegsSql = sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'accountId', a.id, 'accountName', a.name, 'accountType', a.account_type,
  'ownerId', a.owner_id, 'amount', be.amount::text) ORDER BY be.id)
  FROM book_entries be JOIN accounts a ON a.id = be.account_id
  WHERE be.journal_entry_id = je.id), '[]'::jsonb)`;

export async function getCategorizationRecords(ids: number[]): Promise<CategorizationRecord[]> {
  if (!ids.length || ids.length > 100 || new Set(ids).size !== ids.length || ids.some(id => !Number.isSafeInteger(id) || id <= 0)) {
    throw new InvalidCategorizationError('Select between one and 100 distinct transaction IDs.');
  }
  const result = await getDb().execute(sql`
    SELECT je.id AS "journalId", je.date, je.description, je.property_id AS "propertyId",
      je.category_id AS "categoryId", COALESCE(je.is_transfer, FALSE) AS "isTransfer",
      (je.transfer_group_id IS NOT NULL OR je.transfer_partner_journal_id IS NOT NULL) AS "pendingTransfer",
      tm.merchant_name AS "merchantName", tm.bank_category AS "bankCategory",
      tm.transaction_type AS "transactionType", tm.currency,
      ${candidateSnapshotSql()} AS snapshot, ${recordLegsSql} AS legs
    FROM journal_entries je LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
    WHERE je.id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
    ORDER BY je.id
  `);
  return result.rows as unknown as CategorizationRecord[];
}

export async function loadReviewQueue(limit = 25, afterId = 0): Promise<ReviewQueue> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50 || !Number.isSafeInteger(afterId) || afterId < 0) {
    throw new InvalidCategorizationError('Use a page size between one and 50 and a valid review cursor.');
  }
  const db = getDb();
  const activeReview = sql`${candidateEligibilitySql()} AND tc.status = 'needs_review' AND tc.snapshot_hash = ${candidateSnapshotSql()}`;
  const [queue, count, categories] = await Promise.all([
    db.execute(sql`
      SELECT je.id AS "journalId", je.date, je.description, je.property_id AS "propertyId",
        tm.merchant_name AS "merchantName", tm.currency, ${recordLegsSql} AS legs,
        tc.category_id AS "suggestedCategoryId", c.name AS "suggestedCategoryName",
        tc.confidence, tc.reason, tc.evidence, tc.snapshot_hash AS snapshot, tc.updated_at AS "updatedAt"
      FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
      LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
      LEFT JOIN categories c ON c.id = tc.category_id
      WHERE ${activeReview} AND je.id > ${afterId} ORDER BY je.id LIMIT ${limit + 1}
    `),
    db.execute(sql`SELECT COUNT(*)::integer AS total FROM journal_entries je
      JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id WHERE ${activeReview}`),
    db.execute(sql`SELECT id, name, parent_id AS "parentId" FROM categories ORDER BY name, id`),
  ]);
  const items = queue.rows.slice(0, limit).map(row => ({
    ...row,
    evidence: parseMerchantResearchEvidence(row.evidence),
    confidence: row.confidence === null ? null : Number(row.confidence),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  })) as unknown as ReviewItem[];
  return {
    items, total: Number(count.rows[0]?.total ?? 0),
    nextCursor: queue.rows.length > limit ? items.at(-1)!.journalId : null,
    categories: categories.rows as unknown as ReviewQueue['categories'],
  };
}

function contextKey(record: CategorizationRecord): string {
  return categorizationContextKey({ ...record, id: record.journalId } as CategorizationCandidate);
}

/** An explicit user's category choice; category and provenance commit together. */
export async function confirmedCategorize(input: {
  journalId: number; categoryId: number; snapshot: string; remember?: boolean;
}): Promise<{ journalId: number; categoryId: number; remembered: boolean }> {
  const valid = z.object({ journalId: z.number().int().positive(), categoryId: z.number().int().positive(), snapshot: snapshotSchema, remember: z.boolean().optional() }).strict().safeParse(input);
  if (!valid.success) throw new InvalidCategorizationError('Choose a valid transaction, category and current snapshot.');
  const [record] = await getCategorizationRecords([input.journalId]);
  if (!record || record.snapshot !== input.snapshot || record.isTransfer || record.pendingTransfer) throw new CategorizationConflictError();
  const key = contextKey(record);
  const exists = await getDb().execute(sql`SELECT id FROM categories WHERE id = ${input.categoryId}`);
  if (!exists.rows.length) throw new InvalidCategorizationError('The selected category no longer exists.');
  const result = await getDb().execute(sql`
    WITH locked AS MATERIALIZED (
      SELECT je.id FROM journal_entries je
      WHERE je.id = ${input.journalId} AND ${candidateSnapshotSql()} = ${input.snapshot}
        AND COALESCE(je.is_transfer, FALSE) = FALSE
        AND je.transfer_group_id IS NULL AND je.transfer_partner_journal_id IS NULL
      FOR UPDATE OF je
    ), updated AS (
      UPDATE journal_entries je SET category_id = ${input.categoryId}
      FROM locked WHERE je.id = locked.id RETURNING je.id
    ), stored AS (
      INSERT INTO transaction_categorizations (journal_entry_id, snapshot_hash, context_key,
        category_id, confidence, reason, source, status, created_at, updated_at)
      SELECT id, ${input.snapshot}, ${key}, ${input.categoryId}, NULL,
        'Category confirmed by the user.', 'user', 'reviewed', now(), now() FROM updated
      ON CONFLICT (journal_entry_id) DO UPDATE SET snapshot_hash = EXCLUDED.snapshot_hash,
        context_key = EXCLUDED.context_key, category_id = EXCLUDED.category_id,
        evidence = CASE WHEN transaction_categorizations.snapshot_hash = EXCLUDED.snapshot_hash
          THEN transaction_categorizations.evidence ELSE NULL END,
        confidence = NULL, reason = EXCLUDED.reason, source = 'user', status = 'reviewed',
        payee_memory_id = NULL, payee_memory_revision = NULL, updated_at = now()
      RETURNING journal_entry_id
    ), learned AS (
      INSERT INTO categorization_learning (context_key, category_id, created_at, updated_at)
      SELECT ${key}, ${input.categoryId}, now(), now() FROM stored WHERE ${input.remember === true}
      ON CONFLICT (context_key) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
      RETURNING context_key
    ), forgotten AS (
      DELETE FROM categorization_learning learning
      WHERE learning.context_key = ${key} AND learning.category_id <> ${input.categoryId}
        AND ${input.remember !== true} AND EXISTS (SELECT 1 FROM stored)
      RETURNING context_key
    ), conflicting_payees AS (
      UPDATE categorization_payee_memories pm SET status = 'conflicted', revision = pm.revision + 1, updated_at = now()
      WHERE pm.category_id <> ${input.categoryId}
        AND EXISTS (SELECT 1 FROM updated u JOIN journal_entries je ON je.id = u.id WHERE ${payeeCandidateMatchSql()})
      RETURNING pm.id
    ), retired_aliases AS (
      UPDATE categorization_payee_aliases SET active = FALSE
      WHERE memory_id IN (SELECT id FROM conflicting_payees) RETURNING memory_id
    )
    SELECT stored.journal_entry_id AS "journalId", EXISTS(SELECT 1 FROM learned) AS remembered FROM stored
  `);
  if (!result.rows.length) throw new CategorizationConflictError();
  return { journalId: input.journalId, categoryId: input.categoryId, remembered: result.rows[0].remembered === true };
}

export async function decideReview(input: ReviewDecision): Promise<{
  success: true; journalId: number; action: ReviewDecision['action']; categoryId: number | null; remembered: boolean;
}> {
  const valid = reviewDecisionSchema.safeParse(input);
  if (!valid.success) throw new InvalidCategorizationError(valid.error.issues[0]?.message ?? 'Invalid review decision.');
  const [record] = await getCategorizationRecords([input.journalId]);
  if (!record || record.snapshot !== input.snapshot || record.categoryId !== null || record.isTransfer || record.pendingTransfer) throw new CategorizationConflictError();
  const suggestion = await getDb().execute(sql`SELECT category_id FROM transaction_categorizations
    WHERE journal_entry_id = ${input.journalId} AND status = 'needs_review' AND snapshot_hash = ${input.snapshot}`);
  if (!suggestion.rows.length) throw new CategorizationConflictError();
  const categoryId = input.action === 'dismiss' ? null : input.action === 'correct' ? input.categoryId! : suggestion.rows[0].category_id as number | null;
  if (input.action !== 'dismiss' && categoryId === null) throw new InvalidCategorizationError('Choose a category for this uncertain transaction.');
  if (input.action === 'accept' && input.categoryId !== undefined && input.categoryId !== categoryId) throw new InvalidCategorizationError('Use Correct category to change a suggestion.');
  const key = contextKey(record);
  const result = await getDb().execute(sql`
    WITH locked AS MATERIALIZED (
      SELECT je.id FROM journal_entries je
      JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
      WHERE je.id = ${input.journalId} AND ${candidateEligibilitySql()}
        AND ${candidateSnapshotSql()} = ${input.snapshot}
        AND tc.status = 'needs_review' AND tc.snapshot_hash = ${input.snapshot}
        AND (${input.action} <> 'accept' OR tc.category_id IS NOT DISTINCT FROM ${categoryId}::integer)
        AND (${categoryId}::integer IS NULL OR EXISTS (SELECT 1 FROM categories c WHERE c.id = ${categoryId}))
      FOR UPDATE OF je, tc
    ), stored AS (
      UPDATE transaction_categorizations tc
      SET status = ${input.action === 'dismiss' ? 'dismissed' : 'reviewed'}, source = 'user',
        category_id = ${categoryId}, confidence = NULL,
        payee_memory_id = NULL, payee_memory_revision = NULL,
        reason = ${input.action === 'dismiss' ? 'Suggestion dismissed by the user; no category applied.' : 'Category confirmed by the user.'}, updated_at = now()
      FROM locked WHERE tc.journal_entry_id = locked.id RETURNING tc.journal_entry_id
    ), updated AS (
      UPDATE journal_entries je SET category_id = ${categoryId}
      FROM stored WHERE je.id = stored.journal_entry_id AND ${input.action !== 'dismiss'}
      RETURNING je.id
    ), learned AS (
      INSERT INTO categorization_learning (context_key, category_id, created_at, updated_at)
      SELECT ${key}, ${categoryId}, now(), now() FROM updated WHERE ${input.remember && input.action !== 'dismiss'}
      ON CONFLICT (context_key) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
      RETURNING context_key
    ), forgotten AS (
      DELETE FROM categorization_learning learning
      WHERE learning.context_key = ${key} AND learning.category_id <> ${categoryId}::integer
        AND ${!input.remember && input.action !== 'dismiss'} AND EXISTS (SELECT 1 FROM updated)
      RETURNING context_key
    ), conflicting_payees AS (
      UPDATE categorization_payee_memories pm SET status = 'conflicted', revision = pm.revision + 1, updated_at = now()
      WHERE pm.category_id <> ${categoryId}::integer
        AND EXISTS (SELECT 1 FROM updated u JOIN journal_entries je ON je.id = u.id WHERE ${payeeCandidateMatchSql()})
      RETURNING pm.id
    ), retired_aliases AS (
      UPDATE categorization_payee_aliases SET active = FALSE
      WHERE memory_id IN (SELECT id FROM conflicting_payees) RETURNING memory_id
    )
    SELECT stored.journal_entry_id AS "journalId", EXISTS(SELECT 1 FROM learned) AS remembered FROM stored
  `);
  if (!result.rows.length) throw new CategorizationConflictError();
  return { success: true, journalId: input.journalId, action: input.action, categoryId, remembered: result.rows[0].remembered === true };
}
