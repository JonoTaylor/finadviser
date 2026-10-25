import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { londonTodayIso } from '@/lib/dates/today';
import { parseMerchantResearchEvidence } from '@/lib/merchant-research/schema';
import { categorizationActivitySchema, type CategorizationActivity } from './activity-schema';
import { candidateSnapshotSql } from './repository';

function currentAutomaticSql() {
  return sql`tc.source = 'ai' AND tc.status = 'applied'
    AND je.category_id = tc.category_id AND je.date <= ${londonTodayIso()}
    -- Automatic writes start from an uncategorised journal. Rebuild that
    -- original fingerprint while checking every current ledger/context field.
    AND tc.snapshot_hash = ${candidateSnapshotSql('je', sql`NULL`)}
    AND COALESCE(je.is_transfer, FALSE) = FALSE
    AND je.transfer_group_id IS NULL AND je.transfer_partner_journal_id IS NULL`;
}

/** Read-only audit of current automatic labels; no financial record is changed. */
export async function loadCategorizationActivity(): Promise<CategorizationActivity> {
  const [count, latest] = await Promise.all([
    getDb().execute(sql`SELECT
      count(*) FILTER (WHERE tc.assignment_kind = 'standard')::integer AS standard,
      count(*) FILTER (WHERE tc.assignment_kind = 'estimated')::integer AS estimated,
      count(*) FILTER (WHERE tc.assignment_kind = 'broad')::integer AS broad
      FROM transaction_categorizations tc JOIN journal_entries je ON je.id = tc.journal_entry_id
      WHERE ${currentAutomaticSql()}`),
    getDb().execute(sql`SELECT je.id AS "journalId", je.date, je.description, tm.merchant_name AS "merchantName",
      tc.category_id AS "categoryId", c.name AS "categoryName", tc.assignment_kind AS "assignmentKind",
      tc.confidence, tc.reason, tc.evidence, tm.currency, tc.updated_at AS "updatedAt",
      (SELECT CASE WHEN count(*) = 1 THEN min(be.amount)::text ELSE NULL END
        FROM book_entries be JOIN accounts a ON a.id = be.account_id
        WHERE be.journal_entry_id = je.id AND a.account_type IN ('ASSET', 'LIABILITY')) AS amount
      FROM transaction_categorizations tc JOIN journal_entries je ON je.id = tc.journal_entry_id
      JOIN categories c ON c.id = tc.category_id
      LEFT JOIN transaction_metadata tm ON tm.journal_entry_id = je.id
      WHERE ${currentAutomaticSql()} ORDER BY tc.updated_at DESC, je.id DESC LIMIT 20`),
  ]);
  const totals = count.rows[0];
  if (!totals) throw new Error('Automatic category coverage is unavailable.');
  return categorizationActivitySchema.parse({
    counts: { standard: Number(totals.standard), estimated: Number(totals.estimated), broad: Number(totals.broad) },
    items: latest.rows.map(row => ({ ...row,
      confidence: row.assignmentKind !== 'standard' || row.confidence === null ? null : Number(row.confidence),
      updatedAt: (row.updatedAt instanceof Date ? row.updatedAt : new Date(String(row.updatedAt))).toISOString(),
      evidence: parseMerchantResearchEvidence(row.evidence),
    })),
    observedAt: new Date().toISOString(),
  });
}
