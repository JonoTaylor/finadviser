import { and, eq, desc, inArray, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { z } from 'zod';
import { ClientError } from '@/lib/errors';
import { adviserMessageMetadataSchema, type AdviserMessageMetadata } from '@/lib/ai/specialists/contracts';

const { aiConversations, aiMessages } = schema;
const conversationIdSchema = z.number().int().positive().max(2147483647);
const messageRoleSchema = z.enum(['user', 'assistant', 'system']);

function validConversationId(id: number): number {
  if (!conversationIdSchema.safeParse(id).success) throw new ClientError('Use a valid conversation ID.');
  return id;
}

export const conversationRepo = {
  async createConversation(title?: string | null) {
    const db = getDb();
    const [row] = await db
      .insert(aiConversations)
      .values({ title: title ?? null })
      .returning();
    return row;
  },

  async getConversationById(conversationId: number) {
    const id = validConversationId(conversationId);
    const [row] = await getDb().select().from(aiConversations).where(eq(aiConversations.id, id));
    return row ?? null;
  },

  async addMessage(conversationId: number, role: 'user' | 'assistant' | 'system', content: string, metadata?: AdviserMessageMetadata | null) {
    validConversationId(conversationId);
    if (!messageRoleSchema.safeParse(role).success || typeof content !== 'string' || !content.trim() || content.length > 100_000) {
      throw new ClientError('Supply a valid message role and non-empty bounded message.');
    }
    if (metadata != null && role !== 'assistant') throw new ClientError('Specialist review metadata can only be attached to assistant messages.');
    const checkedMetadata = metadata == null ? null : adviserMessageMetadataSchema.safeParse(metadata);
    if (checkedMetadata !== null && !checkedMetadata.success) throw new ClientError('The specialist review metadata is invalid. No message has been saved.');
    const db = getDb();
    // Both changes execute as one PostgreSQL statement. A failed conversation
    // touch must not leave a saved review behind for a retry to duplicate.
    const added = db.$with('added_message').as(db.insert(aiMessages)
      .values({ conversationId, role, content, metadata: checkedMetadata?.data ?? null }).returning());
    const [row] = await db.with(added).update(aiConversations)
      .set({ updatedAt: sql`now()` }).from(added)
      .where(eq(aiConversations.id, added.conversationId))
      .returning({ id: added.id, conversationId: added.conversationId, role: added.role,
        content: added.content, metadata: added.metadata, createdAt: added.createdAt });
    if (!row) throw new Error('The message save could not be confirmed.');
    return row;
  },

  async getMessages(conversationId: number) {
    validConversationId(conversationId);
    const db = getDb();
    return db
      .select()
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(aiMessages.id);
  },

  /** Model context never loads the potentially large saved review metadata. */
  async getModelHistory(conversationId: number, limit = 20) {
    validConversationId(conversationId);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new ClientError('Use a bounded conversation history limit.');
    const messages = await getDb().select({ role: aiMessages.role, content: aiMessages.content })
      .from(aiMessages)
      .where(and(eq(aiMessages.conversationId, conversationId), inArray(aiMessages.role, ['user', 'assistant'])))
      .orderBy(desc(aiMessages.id)).limit(limit);
    return messages.reverse().map(message => ({ ...message, role: message.role as 'user' | 'assistant' }));
  },

  async listConversations() {
    const db = getDb();
    return db
      .select()
      .from(aiConversations)
      .orderBy(desc(aiConversations.updatedAt));
  },
};
