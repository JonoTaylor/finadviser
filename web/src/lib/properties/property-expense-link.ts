import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';

/**
 * Helpers for stamping `journal_entries.property_id` when a journal
 * is categorised under any child of the seeded "Property expenses"
 * parent category.
 *
 * The tax-year report filters by `WHERE je.property_id = $X`, so a
 * transaction categorised as e.g. "Repairs & maintenance" but with
 * `property_id IS NULL` is invisible to the report. These helpers
 * close that loop by auto-linking when the assignment is unambiguous
 * (single-property setup today; explicit propertyId once the user has
 * more than one property).
 */

let cachedSubtreeIds: { ids: number[]; fetchedAt: number } | null = null;
const SUBTREE_TTL_MS = 60_000;

/**
 * Resolve every category id in the "Property expenses" subtree —
 * the parent itself plus EVERY descendant (children, grandchildren,
 * etc). Recursive CTE so user-created sub-sub-categories under e.g.
 * "Repairs & maintenance" are still picked up — the seeded tree is
 * only two levels today, but the user is free to add more depth.
 *
 * In-memory cached for 60s because seed categories don't change at
 * runtime; the cache survives a request but not a deploy.
 */
export async function getPropertyExpenseCategoryIds(): Promise<number[]> {
  if (cachedSubtreeIds && Date.now() - cachedSubtreeIds.fetchedAt < SUBTREE_TTL_MS) {
    return cachedSubtreeIds.ids;
  }
  const db = getDb();
  const rows = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id FROM categories
       WHERE name = 'Property expenses' AND parent_id IS NULL
      UNION ALL
      SELECT c.id FROM categories c
        JOIN subtree s ON c.parent_id = s.id
    )
    SELECT id FROM subtree
  `);
  const ids = rows.rows.map(r => r.id as number);
  cachedSubtreeIds = { ids, fetchedAt: Date.now() };
  return ids;
}

/**
 * Returns the single property's id when the user has exactly one
 * property, or null otherwise. Auto-linking only fires in the
 * single-property case — once the user adds a second property, the
 * AI / form has to specify explicitly which one an expense belongs
 * to.
 */
export async function singlePropertyId(): Promise<number | null> {
  const db = getDb();
  const rows = await db.execute(sql`SELECT id FROM properties LIMIT 2`);
  if (rows.rows.length === 1) return rows.rows[0].id as number;
  return null;
}

/**
 * After a categorisation update, run a single follow-up UPDATE that
 * stamps property_id on any journal in `journalIds` whose new
 * category is in the property-expense subtree AND whose property_id
 * is currently NULL (don't clobber existing links). Uses the single
 * property when the system has exactly one; no-op otherwise.
 *
 * Returns the number of journals that got linked, for telemetry.
 */
export async function autoLinkPropertyExpenses(journalIds: number[]): Promise<number> {
  if (journalIds.length === 0) return 0;
  const propertyId = await singlePropertyId();
  if (propertyId === null) return 0;

  const subtree = await getPropertyExpenseCategoryIds();
  if (subtree.length === 0) return 0;

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE journal_entries
       SET property_id = ${propertyId}
     WHERE id IN (${sql.join(journalIds.map(id => sql`${id}`), sql`, `)})
       AND property_id IS NULL
       AND category_id IN (${sql.join(subtree.map(id => sql`${id}`), sql`, `)})
  `);
  return result.rowCount ?? 0;
}

/**
 * One-shot backfill: link EVERY existing journal that's categorised
 * under the property-expense subtree but has NULL property_id, to
 * the given property. Used by the property page's "Auto-link
 * expenses" button to fix historical data after a categorisation
 * pass.
 *
 * Refuses to run unless the system has exactly one property AND
 * `propertyId` matches that single property. Without this check, a
 * user with two properties hitting "Auto-link existing" on either
 * one would attribute every unlinked property-expense journal to
 * that property — a serious data-integrity hazard. Multi-property
 * users get an explicit-choice flow later (out of scope here).
 *
 * Returns the count of rows updated. Returns 0 (no-op) when the
 * single-property guard fails — the API surfaces that to the user
 * as "no unlinked property expenses found".
 */
export async function backfillPropertyExpensesForProperty(propertyId: number): Promise<number> {
  const singleId = await singlePropertyId();
  if (singleId === null || singleId !== propertyId) return 0;

  const subtree = await getPropertyExpenseCategoryIds();
  if (subtree.length === 0) return 0;

  const db = getDb();
  const result = await db.execute(sql`
    UPDATE journal_entries
       SET property_id = ${propertyId}
     WHERE property_id IS NULL
       AND category_id IN (${sql.join(subtree.map(id => sql`${id}`), sql`, `)})
  `);
  return result.rowCount ?? 0;
}
