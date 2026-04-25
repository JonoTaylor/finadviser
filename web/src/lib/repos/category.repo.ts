import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { categories, categorizationRules } = schema;

export const categoryRepo = {
  async create(data: { name: string; parentId?: number | null; isSystem?: boolean }) {
    const db = getDb();
    const [row] = await db
      .insert(categories)
      .values({
        name: data.name,
        parentId: data.parentId ?? null,
        isSystem: data.isSystem ?? false,
      })
      .returning();
    return row;
  },

  async getById(id: number) {
    const db = getDb();
    const [row] = await db.select().from(categories).where(eq(categories.id, id));
    return row ?? null;
  },

  async getByName(name: string) {
    const db = getDb();
    const [row] = await db.select().from(categories).where(eq(categories.name, name));
    return row ?? null;
  },

  async listAll() {
    const db = getDb();
    return db.select().from(categories).orderBy(categories.name);
  },

  /**
   * Return the children of a category by parent name. Used by the property
   * expense dialog to populate its category dropdown with just the BTL
   * itemised categories (children of 'Property expenses').
   *
   * Uses the Drizzle query builder so the rows come back in the same
   * camelCase shape as listAll() — callers don't have to know which
   * filter form they used.
   */
  async listChildrenOfNamed(parentName: string) {
    const db = getDb();

    // Defensive: there can be more than one root with the same name in
    // legacy data because Postgres unique constraints treat NULLs as
    // distinct. Pick the lowest id.
    const [parent] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.name, parentName), isNull(categories.parentId)))
      .orderBy(asc(categories.id))
      .limit(1);
    if (!parent) return [];

    return db
      .select()
      .from(categories)
      .where(eq(categories.parentId, parent.id))
      .orderBy(asc(categories.name));
  },

  async addRule(data: {
    pattern: string;
    categoryId: number;
    matchType?: 'contains' | 'startswith' | 'exact' | 'regex';
    priority?: number;
    source?: 'user' | 'ai' | 'system';
  }) {
    const db = getDb();
    const [row] = await db
      .insert(categorizationRules)
      .values({
        pattern: data.pattern,
        categoryId: data.categoryId,
        matchType: data.matchType ?? 'contains',
        priority: data.priority ?? 0,
        source: data.source ?? 'user',
      })
      .returning();
    return row;
  },

  async getRules() {
    const db = getDb();
    return db
      .select()
      .from(categorizationRules)
      .orderBy(categorizationRules.priority, categorizationRules.id);
  },

  async deleteRule(id: number) {
    const db = getDb();
    await db.delete(categorizationRules).where(eq(categorizationRules.id, id));
  },

  async updateRule(
    id: number,
    data: {
      pattern?: string;
      matchType?: 'contains' | 'startswith' | 'exact' | 'regex';
      categoryId?: number;
      priority?: number;
    },
  ) {
    const db = getDb();
    const [row] = await db
      .update(categorizationRules)
      .set(data)
      .where(eq(categorizationRules.id, id))
      .returning();
    return row;
  },

  async listRulesWithCategory() {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT cr.id, cr.pattern, cr.match_type, cr.category_id, cr.priority, cr.source, cr.created_at,
             c.name AS category_name
      FROM categorization_rules cr
      LEFT JOIN categories c ON c.id = cr.category_id
      ORDER BY cr.priority DESC, cr.id
    `);
    return rows.rows as Array<{
      id: number;
      pattern: string;
      match_type: string;
      category_id: number;
      priority: number;
      source: string;
      created_at: string;
      category_name: string | null;
    }>;
  },
};
