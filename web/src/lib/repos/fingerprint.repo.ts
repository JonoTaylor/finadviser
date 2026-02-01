import { and, eq } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { transactionFingerprints } = schema;

export const fingerprintRepo = {
  async exists(fingerprint: string, accountId: number): Promise<boolean> {
    const db = getDb();
    const rows = await db
      .select({ id: transactionFingerprints.id })
      .from(transactionFingerprints)
      .where(
        and(
          eq(transactionFingerprints.fingerprint, fingerprint),
          eq(transactionFingerprints.accountId, accountId),
        ),
      )
      .limit(1);
    return rows.length > 0;
  },

  async create(data: { fingerprint: string; accountId: number; journalEntryId: number }) {
    const db = getDb();
    const [row] = await db
      .insert(transactionFingerprints)
      .values(data)
      .returning();
    return row;
  },
};
