import { eq, isNull, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { aiTips } = schema;

export const tipRepo = {
  async create(data: { content: string; tipType?: 'tip' | 'warning' | 'insight'; priority?: number }) {
    const db = getDb();
    const [row] = await db
      .insert(aiTips)
      .values({
        content: data.content,
        tipType: data.tipType ?? 'tip',
        priority: data.priority ?? 0,
      })
      .returning();
    return row;
  },

  async listActive() {
    const db = getDb();
    return db
      .select()
      .from(aiTips)
      .where(isNull(aiTips.dismissedAt))
      .orderBy(aiTips.priority, aiTips.createdAt);
  },

  async dismiss(id: number) {
    const db = getDb();
    await db
      .update(aiTips)
      .set({ dismissedAt: sql`NOW()` })
      .where(eq(aiTips.id, id));
  },

  async deleteOld(keepCount = 20) {
    const db = getDb();
    await db.execute(sql`
      DELETE FROM ai_tips
      WHERE id NOT IN (
        SELECT id FROM ai_tips ORDER BY created_at DESC LIMIT ${keepCount}
      )
    `);
  },
};
