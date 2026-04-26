import { desc, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { aiMemories } = schema;

export type AiMemorySource = (typeof schema.aiMemorySourceEnum.enumValues)[number];
export type AiMemory = typeof aiMemories.$inferSelect;

const MAX_CONTENT_LENGTH = 4000;

export const aiMemoryRepo = {
  async list(): Promise<AiMemory[]> {
    const db = getDb();
    return db.select().from(aiMemories).orderBy(desc(aiMemories.createdAt));
  },

  async add(content: string, source: AiMemorySource): Promise<AiMemory> {
    const trimmed = content.trim();
    if (trimmed.length === 0) {
      throw new Error('Memory content cannot be empty');
    }
    if (trimmed.length > MAX_CONTENT_LENGTH) {
      throw new Error(`Memory content too long (max ${MAX_CONTENT_LENGTH} chars)`);
    }
    const db = getDb();
    const [row] = await db
      .insert(aiMemories)
      .values({ content: trimmed, source })
      .returning();
    return row;
  },

  async delete(id: number): Promise<boolean> {
    const db = getDb();
    const deleted = await db
      .delete(aiMemories)
      .where(eq(aiMemories.id, id))
      .returning({ id: aiMemories.id });
    return deleted.length > 0;
  },

  /**
   * Render every stored memory as a single bullet-list block ready to be
   * appended to the AI system prompt. Returns null if no memories
   * exist so the caller can skip the section entirely.
   *
   * Soft cap: if the rendered block exceeds `maxChars` we drop the
   * oldest memories until it fits — keeping the most recent learning
   * is generally more useful than keeping older context.
   */
  async renderForPrompt(maxChars = 8000): Promise<string | null> {
    const memories = await this.list();
    if (memories.length === 0) return null;

    // Most-recent-first; trim oldest until under cap. Track running
    // length explicitly so we don't re-join the whole array on each
    // pop (which would make this O(N²)).
    const lines = memories.map(m => `- (${m.source}, ${m.createdAt.toISOString().slice(0, 10)}) ${m.content}`);
    let totalLength = lines.reduce((acc, line) => acc + line.length, 0) + Math.max(0, lines.length - 1);
    while (totalLength > maxChars && lines.length > 1) {
      const removed = lines.pop()!;
      totalLength -= removed.length + 1; // line + the separating newline
    }
    return lines.join('\n');
  },
};

export { MAX_CONTENT_LENGTH as AI_MEMORY_MAX_CONTENT_LENGTH };
