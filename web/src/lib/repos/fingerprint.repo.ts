import { and, eq, inArray } from 'drizzle-orm';
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

  /**
   * Bulk lookup: which of these fingerprints already exist for the account.
   * Single query in place of one-per-row, used by the duplicate detector
   * during import — Order(rows) becomes Order(1) round-trips.
   */
  async findExisting(fingerprints: string[], accountId: number): Promise<Set<string>> {
    if (fingerprints.length === 0) return new Set();
    const db = getDb();
    const rows = await db
      .select({ fingerprint: transactionFingerprints.fingerprint })
      .from(transactionFingerprints)
      .where(
        and(
          eq(transactionFingerprints.accountId, accountId),
          inArray(transactionFingerprints.fingerprint, fingerprints),
        ),
      );
    return new Set(rows.map(r => r.fingerprint));
  },

  async create(data: { fingerprint: string; accountId: number; journalEntryId: number }) {
    const db = getDb();
    const [row] = await db
      .insert(transactionFingerprints)
      .values(data)
      .returning();
    return row;
  },

  /**
   * Bulk insert. Same Order(rows) → Order(1) round-trip win as findExisting.
   * No-op for empty input. Returns the number of rows actually inserted
   * (existing rows are skipped via ON CONFLICT — concurrent imports or
   * a partial retry can hit the (fingerprint, accountId) unique index;
   * skipping is preferable to letting one collision blow up the whole
   * statement).
   */
  async createMany(rows: Array<{ fingerprint: string; accountId: number; journalEntryId: number }>): Promise<number> {
    if (rows.length === 0) return 0;
    const db = getDb();
    const inserted = await db
      .insert(transactionFingerprints)
      .values(rows)
      .onConflictDoNothing({
        target: [transactionFingerprints.fingerprint, transactionFingerprints.accountId],
      })
      .returning({ id: transactionFingerprints.id });
    return inserted.length;
  },
};
