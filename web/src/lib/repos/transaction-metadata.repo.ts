import { eq, inArray } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { transactionMetadata } = schema;

export type TransactionMetadata = typeof transactionMetadata.$inferSelect;
export type TransactionMetadataInput = typeof transactionMetadata.$inferInsert;

export const transactionMetadataRepo = {
  async create(input: TransactionMetadataInput): Promise<TransactionMetadata> {
    const db = getDb();
    const [row] = await db.insert(transactionMetadata).values(input).returning();
    return row;
  },

  /**
   * Bulk insert — used by the import pipeline so we don't issue one
   * INSERT per imported row (which would re-introduce the 300s
   * timeout we fixed by chunking journal/book entries).
   *
   * Idempotent on `journalEntryId`: a partial-failure retry, or a
   * concurrent re-run, won't break on the UNIQUE constraint and
   * won't silently lose metadata for rows that already had it.
   */
  async createMany(items: TransactionMetadataInput[]): Promise<void> {
    if (items.length === 0) return;
    const db = getDb();
    await db
      .insert(transactionMetadata)
      .values(items)
      .onConflictDoNothing({ target: transactionMetadata.journalEntryId });
  },

  async getByJournalId(journalEntryId: number): Promise<TransactionMetadata | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(transactionMetadata)
      .where(eq(transactionMetadata.journalEntryId, journalEntryId));
    return row ?? null;
  },

  async getByJournalIds(journalEntryIds: number[]): Promise<Map<number, TransactionMetadata>> {
    const map = new Map<number, TransactionMetadata>();
    if (journalEntryIds.length === 0) return map;
    const db = getDb();
    const rows = await db
      .select()
      .from(transactionMetadata)
      .where(inArray(transactionMetadata.journalEntryId, journalEntryIds));
    for (const r of rows) map.set(r.journalEntryId, r);
    return map;
  },
};
