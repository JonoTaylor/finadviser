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
 * Explicit per-journal property-expense tag. Sets
 * `journal_entries.property_id` (and optionally `category_id`) so a
 * transaction shows up on the property's tax-year report. Used by
 * the AI tagging tools and the transactions UI when the user has
 * multiple properties (the auto-link only fires for single-property
 * setups; with two BTLs the AI has to pick which one each expense
 * belongs to).
 *
 * Validations:
 *   - propertyId must exist
 *   - if categoryId is supplied, it must be in the property-expense
 *     subtree (so we don't silently mistag e.g. a Tesco grocery
 *     transaction as a property expense)
 *   - journalId must exist
 *
 * Returns the updated journal id on success. Throws with a
 * user-actionable message on validation failure.
 */
export async function tagJournalAsPropertyExpense(params: {
  journalId: number;
  propertyId: number;
  categoryId?: number;
}): Promise<{ journalId: number; propertyId: number; categoryId: number | null }> {
  const db = getDb();

  const propertyCheck = await db.execute(sql`
    SELECT id FROM properties WHERE id = ${params.propertyId} LIMIT 1
  `);
  if (propertyCheck.rows.length === 0) {
    throw new Error(`Property ${params.propertyId} not found`);
  }

  if (params.categoryId !== undefined) {
    const subtree = await getPropertyExpenseCategoryIds();
    if (!subtree.includes(params.categoryId)) {
      throw new Error(
        `Category ${params.categoryId} is not in the "Property expenses" subtree. ` +
        `Pick a child of "Property expenses" (e.g. "Repairs & maintenance", "Letting agent fees").`,
      );
    }
  }

  const journalCheck = await db.execute(sql`
    SELECT id, category_id FROM journal_entries WHERE id = ${params.journalId} LIMIT 1
  `);
  if (journalCheck.rows.length === 0) {
    throw new Error(`Journal entry ${params.journalId} not found`);
  }

  if (params.categoryId !== undefined) {
    await db.execute(sql`
      UPDATE journal_entries
         SET property_id = ${params.propertyId},
             category_id = ${params.categoryId}
       WHERE id = ${params.journalId}
    `);
    return { journalId: params.journalId, propertyId: params.propertyId, categoryId: params.categoryId };
  }
  await db.execute(sql`
    UPDATE journal_entries
       SET property_id = ${params.propertyId}
     WHERE id = ${params.journalId}
  `);
  const existingCategoryId = (journalCheck.rows[0].category_id as number | null) ?? null;
  return { journalId: params.journalId, propertyId: params.propertyId, categoryId: existingCategoryId };
}

/**
 * Bulk version of tagJournalAsPropertyExpense. Validates every item
 * up-front; if any fail validation the whole batch is rejected (so
 * the user / AI doesn't end up with half a tagged batch and a
 * confusing partial-success state). Each item can target a
 * different property + category so the AI can group e.g. a
 * letting-agent bill on property A and a repair on property B in
 * one round-trip.
 */
export async function tagJournalsAsPropertyExpensesBulk(
  items: Array<{ journalId: number; propertyId: number; categoryId?: number }>,
): Promise<{ tagged: number }> {
  if (items.length === 0) return { tagged: 0 };

  const db = getDb();

  const propertyIds = Array.from(new Set(items.map(i => i.propertyId)));
  const propRows = await db.execute(sql`
    SELECT id FROM properties WHERE id IN (${sql.join(propertyIds.map(id => sql`${id}`), sql`, `)})
  `);
  const validPropertyIds = new Set(propRows.rows.map(r => r.id as number));
  const missingProperties = propertyIds.filter(id => !validPropertyIds.has(id));
  if (missingProperties.length > 0) {
    throw new Error(`Properties not found: ${missingProperties.join(', ')}`);
  }

  const categoryIdsToCheck = Array.from(new Set(items.map(i => i.categoryId).filter((c): c is number => typeof c === 'number')));
  if (categoryIdsToCheck.length > 0) {
    const subtree = await getPropertyExpenseCategoryIds();
    const subtreeSet = new Set(subtree);
    const offending = categoryIdsToCheck.filter(c => !subtreeSet.has(c));
    if (offending.length > 0) {
      throw new Error(
        `Categories not in "Property expenses" subtree: ${offending.join(', ')}. ` +
        `Pick children of "Property expenses".`,
      );
    }
  }

  const journalIds = items.map(i => i.journalId);
  const jrnRows = await db.execute(sql`
    SELECT id FROM journal_entries WHERE id IN (${sql.join(journalIds.map(id => sql`${id}`), sql`, `)})
  `);
  const validJournalIds = new Set(jrnRows.rows.map(r => r.id as number));
  const missingJournals = journalIds.filter(id => !validJournalIds.has(id));
  if (missingJournals.length > 0) {
    throw new Error(`Journal entries not found: ${missingJournals.join(', ')}`);
  }

  // One UPDATE per item is fine for the small batches the AI is
  // likely to produce (categorisation passes typically tag a few
  // dozen at a time, not thousands). If volumes grow, this can
  // become a single UPDATE...FROM (VALUES (...)) but the per-row
  // shape is more readable for now.
  let count = 0;
  for (const item of items) {
    if (item.categoryId !== undefined) {
      await db.execute(sql`
        UPDATE journal_entries
           SET property_id = ${item.propertyId},
               category_id = ${item.categoryId}
         WHERE id = ${item.journalId}
      `);
    } else {
      await db.execute(sql`
        UPDATE journal_entries
           SET property_id = ${item.propertyId}
         WHERE id = ${item.journalId}
      `);
    }
    count += 1;
  }
  return { tagged: count };
}

/**
 * Clear a journal's property tag. Use when an expense was wrongly
 * attributed (e.g. a personal repair miscategorised as a BTL one).
 * Doesn't touch category_id; leaves the journal where it is in the
 * chart of accounts.
 */
export async function untagJournalPropertyExpense(journalId: number): Promise<{ journalId: number }> {
  const db = getDb();
  const result = await db.execute(sql`
    UPDATE journal_entries SET property_id = NULL WHERE id = ${journalId}
  `);
  if ((result.rowCount ?? 0) === 0) {
    throw new Error(`Journal entry ${journalId} not found`);
  }
  return { journalId };
}

/**
 * Returns the seeded "Property expenses" subtree (the parent itself
 * plus every descendant) as `{id, name, parentId, isLeaf}` rows.
 * Used by the AI's `list_property_expense_categories` tool so the
 * model picks a sensible category without having to filter the
 * full `get_categories` payload.
 */
export async function listPropertyExpenseCategories(): Promise<Array<{ id: number; name: string; parentId: number | null; isLeaf: boolean }>> {
  const db = getDb();
  const rows = await db.execute(sql`
    WITH RECURSIVE subtree AS (
      SELECT id, name, parent_id, 0 AS depth
        FROM categories
       WHERE name = 'Property expenses' AND parent_id IS NULL
      UNION ALL
      SELECT c.id, c.name, c.parent_id, s.depth + 1
        FROM categories c
        JOIN subtree s ON c.parent_id = s.id
    ),
    children_count AS (
      SELECT parent_id, COUNT(*) AS n FROM categories WHERE parent_id IS NOT NULL GROUP BY parent_id
    )
    SELECT s.id, s.name, s.parent_id AS "parentId", COALESCE(cc.n, 0) = 0 AS "isLeaf"
      FROM subtree s
      LEFT JOIN children_count cc ON cc.parent_id = s.id
     ORDER BY s.depth ASC, s.name ASC
  `);
  return rows.rows.map(r => ({
    id: r.id as number,
    name: r.name as string,
    parentId: (r.parentId as number | null) ?? null,
    isLeaf: Boolean(r.isLeaf),
  }));
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
