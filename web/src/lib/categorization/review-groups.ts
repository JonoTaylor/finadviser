import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { parseMerchantResearchEvidence } from '@/lib/merchant-research/schema';
import { categorizationContextKey } from './decisions';
import { candidateEligibilitySql, candidateSnapshotSql } from './repository';
import { payeeCandidateMatchSql } from './payees/sql';
import { CategorizationConflictError, InvalidCategorizationError, getCategorizationRecords } from './review';
import type { CategorizationCandidate } from './types';
import type { ReviewItem, ReviewQueue } from './review';

export interface ReviewGroupItem extends ReviewItem { reviewVersion: string }
export interface ReviewGroup { key: string; items: ReviewGroupItem[]; paymentCount: number; hasMore: boolean }
export interface ReviewGroupsQueue {
  groups: ReviewGroup[]; totalPayments: number; totalGroups: number;
  nextCursor: string | null; hasMore: boolean; categories: ReviewQueue['categories'];
}

const snapshot = z.string().regex(/^[a-f0-9]{32}$/);
const groupKey = z.string().regex(/^[a-f0-9]{64}$/);
const categorySchema = z.object({ id: z.number().int().positive(), name: z.string(), parentId: z.number().int().positive().nullable() }).strict();
const itemSchema = z.object({
  journalId: z.number().int().positive(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), description: z.string(),
  merchantName: z.string().nullable(), currency: z.string().nullable(), propertyId: z.number().int().positive().nullable(),
  legs: z.array(z.object({ accountId: z.number().int().positive(), accountName: z.string(),
    accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']), ownerId: z.number().int().positive().nullable(),
    amount: z.string().regex(/^-?\d+(?:\.\d+)?$/) }).strict()),
  suggestedCategoryId: z.number().int().positive().nullable(), suggestedCategoryName: z.string().nullable(),
  confidence: z.number().min(0).max(1).nullable(), reason: z.string(),
  evidence: z.unknown().transform(value => parseMerchantResearchEvidence(value)), snapshot,
  updatedAt: z.iso.datetime({ offset: true }), reviewVersion: snapshot,
}).strict();
export const reviewGroupsQueueSchema = z.object({
  groups: z.array(z.object({ key: groupKey, items: z.array(itemSchema).min(1).max(100), paymentCount: z.number().int().positive(), hasMore: z.boolean() }).strict()).max(15),
  totalPayments: z.number().int().nonnegative(), totalGroups: z.number().int().nonnegative(),
  nextCursor: groupKey.nullable(), hasMore: z.boolean(), categories: z.array(categorySchema),
}).strict();
export const reviewGroupResultSchema = z.object({
  success: z.literal(true), groupKey, action: z.enum(['accept', 'correct', 'dismiss']), categoryId: z.number().int().positive().nullable(),
  appliedCount: z.number().int().min(1).max(100), remembered: z.boolean(), journalIds: z.array(z.number().int().positive()).min(1).max(100),
}).strict().refine(value => value.appliedCount === value.journalIds.length && new Set(value.journalIds).size === value.journalIds.length);
export const reviewGroupDecisionSchema = z.object({
  groupKey,
  items: z.array(z.object({ journalId: z.number().int().positive(), snapshot, reviewVersion: snapshot }).strict()).min(1).max(100),
  action: z.enum(['accept', 'correct', 'dismiss']),
  categoryId: z.number().int().positive().optional(),
  remember: z.boolean().default(false),
}).strict().superRefine((input, context) => {
  if (new Set(input.items.map(item => item.journalId)).size !== input.items.length) context.addIssue({ code: 'custom', message: 'Select each payment only once.' });
  if (input.action === 'correct' && input.categoryId === undefined) context.addIssue({ code: 'custom', message: 'Choose a category for these payments.' });
  if (input.action === 'dismiss' && (input.remember || input.categoryId !== undefined)) context.addIssue({ code: 'custom', message: 'Leaving payments uncategorised cannot teach a category.' });
});
export type ReviewGroupDecision = z.infer<typeof reviewGroupDecisionSchema>;

/** The journal snapshot does not include its mutable categorisation suggestion. */
export function reviewVersionSql() {
  return sql`md5(jsonb_build_array(tc.snapshot_hash, tc.context_key, tc.category_id, tc.confidence,
    tc.reason, tc.source, tc.status, tc.evidence, tc.payee_memory_id, tc.payee_memory_revision, tc.updated_at)::text)`;
}
function activeReviewSql() {
  return sql`${candidateEligibilitySql()} AND tc.status = 'needs_review' AND tc.snapshot_hash = ${candidateSnapshotSql()}`;
}
const legsSql = sql`COALESCE((SELECT jsonb_agg(jsonb_build_object(
  'accountId', a.id, 'accountName', a.name, 'accountType', a.account_type,
  'ownerId', a.owner_id, 'amount', be.amount::text) ORDER BY be.id)
  FROM book_entries be JOIN accounts a ON a.id = be.account_id WHERE be.journal_entry_id = je.id), '[]'::jsonb)`;

export async function loadReviewGroups(limit = 15, afterKey?: string): Promise<ReviewGroupsQueue> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 15 || (afterKey !== undefined && !groupKey.safeParse(afterKey).success)) {
    throw new InvalidCategorizationError('Use up to 15 groups and a valid group cursor.');
  }
  const [page, totals, categories] = await Promise.all([
    getDb().execute(sql`WITH group_page AS (
      SELECT tc.context_key, count(*)::integer AS payment_count
      FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
      WHERE ${activeReviewSql()} AND (${afterKey === undefined} OR tc.context_key > ${afterKey ?? ''})
      GROUP BY tc.context_key ORDER BY tc.context_key LIMIT ${limit + 1}
    ) SELECT gp.context_key AS key, gp.payment_count,
      (SELECT jsonb_agg(to_jsonb(member) ORDER BY member."journalId") FROM (
        SELECT je.id AS "journalId", je.date, je.description, je.property_id AS "propertyId",
          tm.merchant_name AS "merchantName", tm.currency, ${legsSql} AS legs,
          tc.category_id AS "suggestedCategoryId", c.name AS "suggestedCategoryName", tc.confidence,
          tc.reason, tc.evidence, tc.snapshot_hash AS snapshot, tc.updated_at AS "updatedAt",
          ${reviewVersionSql()} AS "reviewVersion",
          tm.bank_category AS "bankCategory", tm.transaction_type AS "transactionType"
        FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
        LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
        LEFT JOIN categories c ON c.id = tc.category_id
        WHERE ${activeReviewSql()} AND tc.context_key = gp.context_key ORDER BY je.id LIMIT 100
      ) member) AS items FROM group_page gp ORDER BY gp.context_key`),
    getDb().execute(sql`SELECT count(*)::integer AS payments, count(DISTINCT tc.context_key)::integer AS groups
      FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id WHERE ${activeReviewSql()}`),
    getDb().execute(sql`SELECT id, name, parent_id AS "parentId" FROM categories ORDER BY name, id`),
  ]);
  const groups = page.rows.slice(0, limit).map(row => {
    const key = groupKey.parse(row.key);
    if (!Array.isArray(row.items) || row.items.length === 0) throw new Error('A payment group is unavailable.');
    const items = row.items.map((raw: Record<string, unknown>) => {
      // Check the stored grouping key against the actual complete account context.
      const candidate = { ...raw, id: raw.journalId } as unknown as CategorizationCandidate;
      if (categorizationContextKey(candidate) !== key) throw new Error('A payment group context is unavailable.');
      const { bankCategory: _bankCategory, transactionType: _transactionType, ...item } = raw;
      void _bankCategory; void _transactionType;
      return { ...item, confidence: raw.confidence === null ? null : Number(raw.confidence),
        evidence: parseMerchantResearchEvidence(raw.evidence), updatedAt: new Date(String(raw.updatedAt)).toISOString() } as unknown as ReviewGroupItem;
    });
    return { key, items, paymentCount: Number(row.payment_count), hasMore: Number(row.payment_count) > items.length };
  });
  const hasMore = page.rows.length > limit;
  return reviewGroupsQueueSchema.parse({ groups, totalPayments: Number(totals.rows[0]?.payments ?? 0), totalGroups: Number(totals.rows[0]?.groups ?? 0),
    hasMore, nextCursor: hasMore ? groups.at(-1)!.key : null, categories: categories.rows as unknown as ReviewQueue['categories'] });
}

/** Apply only the explicitly previewed members, with one atomic all-or-none write. */
export async function decideReviewGroup(input: ReviewGroupDecision) {
  const parsed = reviewGroupDecisionSchema.safeParse(input);
  if (!parsed.success) throw new InvalidCategorizationError(parsed.error.issues[0]?.message ?? 'Choose valid payments and a category.');
  const valid = parsed.data;
  const ids = valid.items.map(item => item.journalId);
  const records = await getCategorizationRecords(ids);
  const selected = new Map(valid.items.map(item => [item.journalId, item]));
  if (records.length !== ids.length || records.some(record => record.categoryId !== null || record.isTransfer || record.pendingTransfer
    || record.snapshot !== selected.get(record.journalId)!.snapshot
    || categorizationContextKey({ ...record, id: record.journalId }) !== valid.groupKey)) throw new CategorizationConflictError();
  const current = await getDb().execute(sql`SELECT je.id, tc.category_id, ${reviewVersionSql()} AS version
    FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
    WHERE je.id IN (SELECT value::integer FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb))
      AND ${activeReviewSql()} AND tc.context_key = ${valid.groupKey}`);
  if (current.rows.length !== ids.length || current.rows.some(row => row.version !== selected.get(Number(row.id))?.reviewVersion)) throw new CategorizationConflictError();
  const categoryId = valid.action === 'dismiss' ? null : valid.action === 'correct' ? valid.categoryId!
    : current.rows[0].category_id === null ? null : Number(current.rows[0].category_id);
  if (valid.action !== 'dismiss' && categoryId === null) throw new InvalidCategorizationError('Choose a category for these payments.');
  if (valid.action === 'accept' && (current.rows.some(row => Number(row.category_id) !== categoryId)
    || (valid.categoryId !== undefined && valid.categoryId !== categoryId))) throw new InvalidCategorizationError('The suggestions differ. Choose one category explicitly to correct these payments.');
  const result = await getDb().execute(sql`WITH proposed AS (
    SELECT * FROM jsonb_to_recordset(${JSON.stringify(valid.items)}::jsonb)
      AS p("journalId" integer, snapshot text, "reviewVersion" text)
  ), locked AS MATERIALIZED (
    SELECT je.id FROM journal_entries je JOIN transaction_categorizations tc ON tc.journal_entry_id = je.id
    JOIN proposed p ON p."journalId" = je.id
    WHERE ${activeReviewSql()} AND ${candidateSnapshotSql()} = p.snapshot
      AND tc.context_key = ${valid.groupKey} AND ${reviewVersionSql()} = p."reviewVersion"
      AND (${valid.action} <> 'accept' OR tc.category_id IS NOT DISTINCT FROM ${categoryId}::integer)
    ORDER BY je.id FOR UPDATE OF je, tc
  ), allowed AS (
    SELECT id FROM locked WHERE (SELECT count(*) FROM locked) = ${ids.length}
      AND (${categoryId}::integer IS NULL OR EXISTS (SELECT 1 FROM categories WHERE id = ${categoryId}))
  ), stored AS (
    UPDATE transaction_categorizations tc SET status = ${valid.action === 'dismiss' ? 'dismissed' : 'reviewed'}, source = 'user',
      category_id = ${categoryId}, confidence = NULL, payee_memory_id = NULL, payee_memory_revision = NULL,
      reason = ${valid.action === 'dismiss' ? 'Suggestion dismissed by the user; no category applied.' : 'Category confirmed by the user for the explicitly selected payment group.'},
      updated_at = now() FROM allowed WHERE tc.journal_entry_id = allowed.id RETURNING tc.journal_entry_id
  ), updated AS (
    UPDATE journal_entries je SET category_id = ${categoryId} FROM stored
    WHERE je.id = stored.journal_entry_id AND ${valid.action !== 'dismiss'} RETURNING je.id
  ), learned AS (
    INSERT INTO categorization_learning (context_key, category_id, created_at, updated_at)
    SELECT ${valid.groupKey}, ${categoryId}, now(), now() WHERE ${valid.remember && valid.action !== 'dismiss'}
      AND (SELECT count(*) FROM updated) = ${ids.length}
    ON CONFLICT (context_key) DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now() RETURNING context_key
  ), forgotten AS (
    DELETE FROM categorization_learning learning WHERE learning.context_key = ${valid.groupKey}
      AND learning.category_id <> ${categoryId}::integer AND ${!valid.remember && valid.action !== 'dismiss'}
      AND EXISTS (SELECT 1 FROM updated) RETURNING context_key
  ), conflicting_payees AS (
    UPDATE categorization_payee_memories pm SET status = 'conflicted', revision = pm.revision + 1, updated_at = now()
    WHERE pm.category_id <> ${categoryId}::integer
      AND EXISTS (SELECT 1 FROM updated u JOIN journal_entries je ON je.id = u.id WHERE ${payeeCandidateMatchSql()}) RETURNING pm.id
  ), retired_aliases AS (
    UPDATE categorization_payee_aliases SET active = FALSE WHERE memory_id IN (SELECT id FROM conflicting_payees) RETURNING memory_id
  ) SELECT journal_entry_id FROM stored ORDER BY journal_entry_id`);
  if (result.rows.length !== ids.length) throw new CategorizationConflictError();
  return reviewGroupResultSchema.parse({ success: true as const, groupKey: valid.groupKey, action: valid.action, categoryId,
    appliedCount: result.rows.length, remembered: valid.remember && valid.action !== 'dismiss',
    journalIds: result.rows.map(row => Number(row.journal_entry_id)) });
}
