import { eq } from 'drizzle-orm';
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
};
