import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { tenancies } = schema;

/** Derived from the Drizzle enum so DB / repo / UI all share one type. */
export type RentFrequency = (typeof schema.rentFrequencyEnum.enumValues)[number];

/** Schema-inferred row shape; use this everywhere we return tenancies. */
export type Tenancy = typeof tenancies.$inferSelect;

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
  async create(input: TenancyInput): Promise<Tenancy> {
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

  async update(id: number, patch: Partial<TenancyInput>): Promise<Tenancy | null> {
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

  async delete(id: number): Promise<void> {
    const db = getDb();
    await db.delete(tenancies).where(eq(tenancies.id, id));
  },

  async get(id: number): Promise<Tenancy | null> {
    const db = getDb();
    const [row] = await db.select().from(tenancies).where(eq(tenancies.id, id));
    return row ?? null;
  },

  async listByProperty(propertyId: number): Promise<Tenancy[]> {
    const db = getDb();
    return db
      .select()
      .from(tenancies)
      .where(eq(tenancies.propertyId, propertyId))
      .orderBy(desc(tenancies.startDate));
  },

  /**
   * Active tenancy on a given date: start_date <= date AND (end_date IS NULL
   * OR end_date >= date). Returns the most recently started match if more
   * than one is active (i.e. overlapping data-entry).
   *
   * Uses Drizzle's typed query builder so the row is returned with the same
   * camelCase shape as the rest of the repo (the previous raw SQL execute()
   * returned snake_case keys, which would have surprised callers).
   */
  async getActiveOn(propertyId: number, isoDate: string): Promise<Tenancy | null> {
    const db = getDb();
    const [row] = await db
      .select()
      .from(tenancies)
      .where(
        and(
          eq(tenancies.propertyId, propertyId),
          lte(tenancies.startDate, isoDate),
          or(isNull(tenancies.endDate), gte(tenancies.endDate, isoDate)),
        ),
      )
      .orderBy(desc(tenancies.startDate))
      .limit(1);
    return row ?? null;
  },
};
