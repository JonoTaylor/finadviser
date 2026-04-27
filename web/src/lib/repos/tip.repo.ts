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

  /**
   * Idempotent insert keyed on `tag`. The partial unique index
   * (tag) WHERE dismissed_at IS NULL enforces "one active tip per
   * tag at a time"; this helper relies on that to avoid duplicates
   * when the daily cron runs twice in a window or the same condition
   * triggers two tip writes.
   *
   * Returns true if a new row was inserted, false if an active tip
   * with the same tag already existed.
   */
  async upsertTagged(data: {
    tag: string;
    content: string;
    tipType?: 'tip' | 'warning' | 'insight';
    priority?: number;
  }): Promise<boolean> {
    const db = getDb();
    const result = await db.execute(sql`
      INSERT INTO ai_tips (content, tip_type, priority, tag)
      VALUES (${data.content}, ${data.tipType ?? 'tip'}, ${data.priority ?? 0}, ${data.tag})
      ON CONFLICT (tag) WHERE tag IS NOT NULL AND dismissed_at IS NULL DO NOTHING
      RETURNING id
    `);
    return result.rows.length > 0;
  },

  /**
   * Dismiss any active tip with the given tag. Used to clear an
   * "expiring" tip once the connection has been reconnected (so the
   * new consent_expires_at no longer trips the 7-day window).
   */
  async dismissByTag(tag: string) {
    const db = getDb();
    await db.execute(sql`
      UPDATE ai_tips
         SET dismissed_at = now()
       WHERE tag = ${tag} AND dismissed_at IS NULL
    `);
  },

  async listActive() {
    const db = getDb();
    return db
      .select()
      .from(aiTips)
      .where(isNull(aiTips.dismissedAt))
      // Higher `priority` = more urgent. Newer first within a tier so
      // freshly-written warnings (e.g. expiring consent flagged by
      // today's cron) bubble above stale tips at the same level.
      .orderBy(sql`${aiTips.priority} DESC`, sql`${aiTips.createdAt} DESC`);
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
