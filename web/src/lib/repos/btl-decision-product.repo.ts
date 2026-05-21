import { and, eq, isNull } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { btlDecisionProducts } = schema;

export type BtlDecisionProductRow = typeof btlDecisionProducts.$inferSelect;

export interface BtlDecisionProductInput {
  propertyId: number;
  name: string;
  productType: string;
  ratePct: string;
  productFee: string;
  exitFee: string;
  monthlyPayment: string;
  ercSchedule: Array<{ untilMonth: number; pct: string }>;
}

export const btlDecisionProductRepo = {
  async listByProperty(propertyId: number): Promise<BtlDecisionProductRow[]> {
    const db = getDb();
    return db
      .select()
      .from(btlDecisionProducts)
      .where(
        and(
          eq(btlDecisionProducts.propertyId, propertyId),
          isNull(btlDecisionProducts.archivedAt),
        ),
      )
      .orderBy(btlDecisionProducts.createdAt);
  },

  async create(input: BtlDecisionProductInput): Promise<BtlDecisionProductRow> {
    const db = getDb();
    const [row] = await db
      .insert(btlDecisionProducts)
      .values({
        propertyId: input.propertyId,
        name: input.name,
        productType: input.productType,
        ratePct: input.ratePct,
        productFee: input.productFee,
        exitFee: input.exitFee,
        monthlyPayment: input.monthlyPayment,
        ercSchedule: input.ercSchedule,
      })
      .returning();
    return row;
  },

  async update(
    id: number,
    propertyId: number,
    patch: Partial<Omit<BtlDecisionProductInput, 'propertyId'>>,
  ): Promise<BtlDecisionProductRow | null> {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.productType !== undefined) updates.productType = patch.productType;
    if (patch.ratePct !== undefined) updates.ratePct = patch.ratePct;
    if (patch.productFee !== undefined) updates.productFee = patch.productFee;
    if (patch.exitFee !== undefined) updates.exitFee = patch.exitFee;
    if (patch.monthlyPayment !== undefined) updates.monthlyPayment = patch.monthlyPayment;
    if (patch.ercSchedule !== undefined) updates.ercSchedule = patch.ercSchedule;
    if (Object.keys(updates).length === 0) {
      const [row] = await db
        .select()
        .from(btlDecisionProducts)
        .where(
          and(
            eq(btlDecisionProducts.id, id),
            eq(btlDecisionProducts.propertyId, propertyId),
            isNull(btlDecisionProducts.archivedAt),
          ),
        );
      return row ?? null;
    }
    // Refuse to mutate soft-archived rows so historical product
    // candidates stay immutable — same archived_at guard as the
    // archive() helper for consistency.
    const [row] = await db
      .update(btlDecisionProducts)
      .set(updates)
      .where(
        and(
          eq(btlDecisionProducts.id, id),
          eq(btlDecisionProducts.propertyId, propertyId),
          isNull(btlDecisionProducts.archivedAt),
        ),
      )
      .returning();
    return row ?? null;
  },

  /**
   * Soft delete: set archived_at so historical comparisons can still
   * read prior product candidates. The list endpoint filters them out.
   * IDOR-safe: WHERE clause matches BOTH id and property_id so a
   * caller can't archive a product belonging to another property.
   */
  async archive(id: number, propertyId: number): Promise<boolean> {
    const db = getDb();
    const result = await db
      .update(btlDecisionProducts)
      .set({ archivedAt: new Date() })
      .where(
        and(
          eq(btlDecisionProducts.id, id),
          eq(btlDecisionProducts.propertyId, propertyId),
          isNull(btlDecisionProducts.archivedAt),
        ),
      )
      .returning({ id: btlDecisionProducts.id });
    return result.length > 0;
  },
};
