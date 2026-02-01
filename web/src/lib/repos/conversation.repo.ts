import { eq, desc, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { aiConversations, aiMessages } = schema;

export const conversationRepo = {
  async createConversation(title?: string | null) {
    const db = getDb();
    const [row] = await db
      .insert(aiConversations)
      .values({ title: title ?? null })
      .returning();
    return row;
  },

  async addMessage(conversationId: number, role: 'user' | 'assistant' | 'system', content: string) {
    const db = getDb();
    const [row] = await db
      .insert(aiMessages)
      .values({ conversationId, role, content })
      .returning();
    // Update conversation updated_at
    await db.execute(sql`
      UPDATE ai_conversations SET updated_at = NOW() WHERE id = ${conversationId}
    `);
    return row;
  },

  async getMessages(conversationId: number) {
    const db = getDb();
    return db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.id);
  },

  async listConversations() {
    const db = getDb();
    return db
      .select()
      .from(aiConversations)
      .orderBy(desc(aiConversations.updatedAt));
  },
};
