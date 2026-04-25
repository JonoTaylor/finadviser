import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { tenancies } = schema;

export type RentFrequency = 'monthly' | 'weekly' | 'four_weekly' | 'quarterly' | 'annual';

export interface TenancyInput {
  propertyId: number;
  tenantName: string;
  startDate: string;
  endDate?: string | null;
  rentAmount: string;
  rentFrequency?: RentFrequency;
  depositAmount?: string | null;
  notes?: string | null;
}

export const tenancyRepo = {
  async create(input: TenancyInput) {
    const db = getDb();
    const [row] = await db
      .insert(tenancies)
      .values({
        propertyId: input.propertyId,
        tenantName: input.tenantName,
        startDate: input.startDate,
        endDate: input.endDate ?? null,
        rentAmount: input.rentAmount,
        rentFrequency: input.rentFrequency ?? 'monthly',
        depositAmount: input.depositAmount ?? null,
        notes: input.notes ?? null,
      })
      .returning();
    return row;
  },

  async update(id: number, patch: Partial<TenancyInput>) {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (patch.tenantName !== undefined) updates.tenantName = patch.tenantName;
    if (patch.startDate !== undefined) updates.startDate = patch.startDate;
    if (patch.endDate !== undefined) updates.endDate = patch.endDate;
    if (patch.rentAmount !== undefined) updates.rentAmount = patch.rentAmount;
    if (patch.rentFrequency !== undefined) updates.rentFrequency = patch.rentFrequency;
    if (patch.depositAmount !== undefined) updates.depositAmount = patch.depositAmount;
    if (patch.notes !== undefined) updates.notes = patch.notes;

    if (Object.keys(updates).length === 0) return this.get(id);

    const [row] = await db
      .update(tenancies)
      .set(updates)
      .where(eq(tenancies.id, id))
      .returning();
    return row ?? null;
  },

  async delete(id: number) {
    const db = getDb();
    await db.delete(tenancies).where(eq(tenancies.id, id));
  },

  async get(id: number) {
    const db = getDb();
    const [row] = await db.select().from(tenancies).where(eq(tenancies.id, id));
    return row ?? null;
  },

  async listByProperty(propertyId: number) {
    const db = getDb();
    return db
      .select()
      .from(tenancies)
      .where(eq(tenancies.propertyId, propertyId))
      .orderBy(sql`start_date DESC`);
  },

  /**
   * Active tenancy on a given date: start_date <= date AND (end_date IS NULL OR end_date >= date).
   * If multiple tenancies overlap (data entry error), returns the most recently started.
   */
  async getActiveOn(propertyId: number, isoDate: string) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT * FROM tenancies
      WHERE property_id = ${propertyId}
        AND start_date <= ${isoDate}
        AND (end_date IS NULL OR end_date >= ${isoDate})
      ORDER BY start_date DESC
      LIMIT 1
    `);
    return rows.rows[0] ?? null;
  },
};
