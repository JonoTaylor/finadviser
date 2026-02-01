import { eq, desc } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { importBatches } = schema;

export const importBatchRepo = {
  async create(data: {
    filename: string;
    bankConfig: string;
    accountId: number;
    rowCount?: number;
    importedCount?: number;
    duplicateCount?: number;
  }) {
    const db = getDb();
    const [row] = await db
      .insert(importBatches)
      .values({
        filename: data.filename,
        bankConfig: data.bankConfig,
        accountId: data.accountId,
        rowCount: data.rowCount ?? 0,
        importedCount: data.importedCount ?? 0,
        duplicateCount: data.duplicateCount ?? 0,
      })
      .returning();
    return row;
  },

  async updateCounts(batchId: number, imported: number, duplicates: number) {
    const db = getDb();
    await db
      .update(importBatches)
      .set({ importedCount: imported, duplicateCount: duplicates })
      .where(eq(importBatches.id, batchId));
  },

  async listAll() {
    const db = getDb();
    return db.select().from(importBatches).orderBy(desc(importBatches.importedAt));
  },
};
