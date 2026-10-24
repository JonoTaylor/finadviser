import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { candidateSnapshotSql } from '../repository';
import { payeeSourceValiditySql } from './sql';
import type { PayeeMemory, PayeeScope } from './types';
import type { PayeeSaveInput } from './schema';

export class PayeeMemoryConflictError extends Error {
  constructor() { super('This payment or saved payee meaning changed, or its alias already has a meaning. Reload the current details before saving.'); this.name = 'PayeeMemoryConflictError'; }
}
export class InvalidPayeeMemoryError extends Error {
  constructor(message = 'Choose a valid payment, category and exact payee identity.') { super(message); this.name = 'InvalidPayeeMemoryError'; }
}

function iso(value: unknown): string {
  const date = value instanceof Date ? value : typeof value === 'string' ? new Date(value) : null;
  if (!date || !Number.isFinite(date.getTime())) throw new Error('Saved payee time is unavailable.');
  return date.toISOString();
}
function memory(row: Record<string, unknown>): PayeeMemory {
  return {
    id: String(row.id), revision: Number(row.revision), status: row.status as PayeeMemory['status'],
    scope: { accountId: Number(row.account_id), accountName: String(row.account_name), accountType: row.account_type as PayeeScope['accountType'],
      ownerId: row.owner_id === null ? null : Number(row.owner_id), direction: Number(row.direction) as -1 | 1,
      currency: row.currency as string | null, propertyId: row.property_id === null ? null : Number(row.property_id) },
    payeeName: String(row.payee_name), purpose: row.purpose as string | null,
    categoryId: Number(row.category_id), categoryName: String(row.category_name), identityKind: row.identity_kind as PayeeMemory['identityKind'],
    aliases: row.aliases as string[], sourceJournalId: row.source_journal_id === null ? null : Number(row.source_journal_id),
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
  };
}
const columns = sql`pm.id, pm.revision,
  CASE WHEN pm.status = 'active' AND NOT ${payeeSourceValiditySql()} THEN 'conflicted' ELSE pm.status END AS status,
  pm.scope_key, pm.account_id, pm.owner_id, pm.account_type, pm.direction, pm.currency, pm.property_id,
  pm.payee_name, pm.purpose, pm.category_id, pm.identity_kind, pm.source_journal_id, pm.created_at, pm.updated_at,
  a.name AS account_name, c.name AS category_name,
  COALESCE((SELECT jsonb_agg(pa.display_alias ORDER BY pa.normalized_alias)
    FROM categorization_payee_aliases pa WHERE pa.memory_id = pm.id AND pa.identity_kind = pm.identity_kind
      AND pa.is_current = TRUE), '[]'::jsonb) AS aliases`;

export const payeeMemoryRepo = {
  async list(scopeKeys?: string[], activeOnly = false): Promise<PayeeMemory[]> {
    if (scopeKeys?.length === 0) return [];
    const condition = scopeKeys ? sql`AND pm.scope_key IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(scopeKeys)}::jsonb))` : sql``;
    const result = await getDb().execute(sql`SELECT ${columns} FROM categorization_payee_memories pm
      JOIN accounts a ON a.id = pm.account_id JOIN categories c ON c.id = pm.category_id
      WHERE (${!activeOnly} OR (pm.status = 'active' AND ${payeeSourceValiditySql()})) ${condition}
      ORDER BY pm.updated_at DESC, pm.id LIMIT ${activeOnly ? 5001 : 500}`);
    if (activeOnly && result.rows.length > 5000) throw new Error('The saved payee matching limit was reached.');
    return result.rows.map(row => memory(row));
  },
  async get(id: string): Promise<PayeeMemory | null> {
    const result = await getDb().execute(sql`SELECT ${columns} FROM categorization_payee_memories pm
      JOIN accounts a ON a.id = pm.account_id JOIN categories c ON c.id = pm.category_id WHERE pm.id = ${id}::uuid`);
    return result.rows[0] ? memory(result.rows[0]) : null;
  },
  async invalidateStale(scopeKeys?: string[]): Promise<void> {
    if (scopeKeys?.length === 0) return;
    const scope = scopeKeys ? sql`pm.scope_key IN (SELECT value FROM jsonb_array_elements_text(${JSON.stringify(scopeKeys)}::jsonb))` : sql`TRUE`;
    await getDb().execute(sql`WITH invalidated AS (
      UPDATE categorization_payee_memories pm SET status = 'conflicted', revision = revision + 1, updated_at = now()
      WHERE pm.status = 'active' AND ${scope}
        AND NOT ${payeeSourceValiditySql()} RETURNING id
    ) UPDATE categorization_payee_aliases SET active = FALSE WHERE memory_id IN (SELECT id FROM invalidated)`);
  },
  async disable(id: string, revision: number): Promise<PayeeMemory> {
    const result = await getDb().execute(sql`WITH disabled AS (
      UPDATE categorization_payee_memories SET status = 'disabled', revision = revision + 1, updated_at = now()
      WHERE id = ${id}::uuid AND revision = ${revision} RETURNING id
    ), aliases AS (
      UPDATE categorization_payee_aliases SET active = FALSE WHERE memory_id IN (SELECT id FROM disabled) RETURNING memory_id
    ) SELECT id FROM disabled`);
    if (!result.rows.length) throw new PayeeMemoryConflictError();
    const saved = await this.get(id);
    if (!saved) throw new PayeeMemoryConflictError();
    return saved;
  },
  async privateNames(): Promise<string[]> {
    const result = await getDb().execute(sql`SELECT DISTINCT name FROM (
      SELECT payee_name AS name FROM categorization_payee_memories
      UNION ALL SELECT display_alias AS name FROM categorization_payee_aliases
    ) names WHERE name <> '' LIMIT 5001`);
    // Fail closed rather than silently dropping older private identities.
    if (result.rows.length > 5000) throw new Error('The private identity exclusion list is unavailable.');
    return result.rows.map(row => String(row.name));
  },
  async save(input: PayeeSaveInput, data: { id: string; scope: PayeeScope; scopeKey: string; contextKey: string; aliases: { normalized: string; display: string }[] }): Promise<PayeeMemory> {
    const { id, scope, scopeKey, aliases } = data;
    const targetRevision = input.expectedRevision ?? null;
    try {
      const result = await getDb().execute(sql`
        WITH locked AS MATERIALIZED (
          SELECT je.id FROM journal_entries je WHERE je.id = ${input.journalId}
            AND ${candidateSnapshotSql()} = ${input.snapshot}
            AND COALESCE(je.is_transfer, FALSE) = FALSE AND je.transfer_group_id IS NULL AND je.transfer_partner_journal_id IS NULL
            AND EXISTS (SELECT 1 FROM categories WHERE id = ${input.categoryId})
          FOR UPDATE OF je
        ), current_memory AS MATERIALIZED (
          SELECT * FROM categorization_payee_memories WHERE id = ${id}::uuid AND (SELECT count(*) FROM locked) >= 0 FOR UPDATE
        ), allowed AS (
          SELECT id FROM locked WHERE
            (${input.memoryId === undefined} OR EXISTS (SELECT 1 FROM current_memory WHERE revision = ${targetRevision} AND scope_key = ${scopeKey}))
            AND NOT EXISTS (SELECT 1 FROM categorization_payee_aliases pa
              WHERE pa.scope_key = ${scopeKey} AND pa.identity_kind = ${input.identityKind} AND pa.active
                AND pa.memory_id <> ${id}::uuid AND pa.normalized_alias IN (
                  SELECT value->>'normalized' FROM jsonb_array_elements(${JSON.stringify(aliases)}::jsonb)))
        ), retired AS (
          UPDATE categorization_payee_aliases SET active = FALSE, is_current = FALSE
          WHERE memory_id = ${id}::uuid AND EXISTS (SELECT 1 FROM allowed)
            AND (identity_kind <> ${input.identityKind} OR normalized_alias NOT IN (
              SELECT value->>'normalized' FROM jsonb_array_elements(${JSON.stringify(aliases)}::jsonb)))
          RETURNING memory_id
        ), saved AS (
          INSERT INTO categorization_payee_memories (id, revision, status, scope_key, account_id, owner_id, account_type,
            direction, currency, property_id, payee_name, purpose, category_id, identity_kind, source_journal_id)
          SELECT ${id}::uuid, 1, 'active', ${scopeKey}, ${scope.accountId}, ${scope.ownerId}, ${scope.accountType},
            ${scope.direction}, ${scope.currency}, ${scope.propertyId}, ${input.payeeName}, ${input.purpose ?? null},
            ${input.categoryId}, ${input.identityKind}, id FROM allowed
          WHERE (SELECT count(*) FROM retired) >= 0
          ON CONFLICT (id) DO UPDATE SET revision = categorization_payee_memories.revision + 1, status = 'active',
            payee_name = EXCLUDED.payee_name, purpose = EXCLUDED.purpose, category_id = EXCLUDED.category_id,
            identity_kind = EXCLUDED.identity_kind, source_journal_id = EXCLUDED.source_journal_id, updated_at = now()
          WHERE categorization_payee_memories.revision = ${targetRevision} RETURNING *
        ), saved_aliases AS (
          INSERT INTO categorization_payee_aliases (memory_id, scope_key, identity_kind, normalized_alias, display_alias, active, is_current)
          SELECT saved.id, saved.scope_key, saved.identity_kind, item->>'normalized', item->>'display', TRUE, TRUE
          FROM saved CROSS JOIN jsonb_array_elements(${JSON.stringify(aliases)}::jsonb) item
          ON CONFLICT (memory_id, identity_kind, normalized_alias) DO UPDATE SET display_alias = EXCLUDED.display_alias, active = TRUE, is_current = TRUE
          RETURNING display_alias, normalized_alias
        ), updated AS (
          UPDATE journal_entries je SET category_id = ${input.categoryId} FROM saved WHERE je.id = saved.source_journal_id RETURNING je.id
        ), confirmed AS (
          INSERT INTO transaction_categorizations (journal_entry_id, snapshot_hash, context_key, category_id,
            confidence, reason, source, status, created_at, updated_at)
          SELECT id, ${input.snapshot}, ${data.contextKey}, ${input.categoryId}, NULL,
            'Category and private payee meaning confirmed by the user.', 'user', 'reviewed', now(), now() FROM updated
          ON CONFLICT (journal_entry_id) DO UPDATE SET snapshot_hash = EXCLUDED.snapshot_hash, context_key = EXCLUDED.context_key,
            category_id = EXCLUDED.category_id, confidence = NULL, reason = EXCLUDED.reason, source = 'user', status = 'reviewed', updated_at = now(),
            payee_memory_id = NULL, payee_memory_revision = NULL,
            evidence = CASE WHEN transaction_categorizations.snapshot_hash = EXCLUDED.snapshot_hash THEN transaction_categorizations.evidence ELSE NULL END
          RETURNING journal_entry_id
        ), retired_learning AS (
          DELETE FROM categorization_learning WHERE context_key = ${data.contextKey}
            AND category_id <> ${input.categoryId} AND EXISTS (SELECT 1 FROM confirmed)
          RETURNING context_key
        ) SELECT saved.*, a.name AS account_name, c.name AS category_name,
          (SELECT jsonb_agg(display_alias ORDER BY normalized_alias) FROM saved_aliases) AS aliases
          FROM saved JOIN accounts a ON a.id = saved.account_id JOIN categories c ON c.id = saved.category_id
          WHERE EXISTS (SELECT 1 FROM confirmed) AND EXISTS (SELECT 1 FROM saved_aliases)
      `);
      if (!result.rows.length) throw new PayeeMemoryConflictError();
      return memory(result.rows[0]);
    } catch (error) {
      if (error instanceof PayeeMemoryConflictError) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') throw new PayeeMemoryConflictError();
      throw error;
    }
  },
};

export { payeeSourceValiditySql, payeeCandidateMatchSql } from './sql';
