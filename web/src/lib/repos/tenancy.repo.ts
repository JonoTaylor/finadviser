import { and, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';
import { ClientError } from '@/lib/errors';
import { isValidCalendarDate } from '@/lib/properties/mortgage-rate-validation';
import { nonNegativeMoney } from '@/lib/tax/moneyInput';

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

/**
 * Tenancies drive the rent schedule and tax-year reports, which compare
 * dates as YYYY-MM-DD strings, so malformed values are refused here for
 * every caller. `existing` supplies the other date when a patch changes one.
 */
export function validateTenancyFields(
  fields: Partial<TenancyInput>,
  existing?: Pick<Tenancy, 'startDate' | 'endDate'>,
): void {
  if (fields.tenantName !== undefined && (typeof fields.tenantName !== 'string' || !fields.tenantName.trim())) {
    throw new ClientError('Enter the tenant name.');
  }
  if (fields.startDate !== undefined && !isValidCalendarDate(fields.startDate)) {
    throw new ClientError('Enter the tenancy start date as YYYY-MM-DD.');
  }
  if (fields.endDate != null && !isValidCalendarDate(fields.endDate)) {
    throw new ClientError('Enter the tenancy end date as YYYY-MM-DD, or leave it empty.');
  }
  const start = fields.startDate ?? existing?.startDate;
  const end = fields.endDate !== undefined ? fields.endDate : existing?.endDate;
  if (start && end && isValidCalendarDate(start) && isValidCalendarDate(end) && end < start) {
    throw new ClientError('The tenancy end date cannot be before its start date.');
  }
  if (fields.rentAmount !== undefined && !nonNegativeMoney(fields.rentAmount, 'Rent amount').gt(0)) {
    throw new ClientError('Rent amount must be more than zero.');
  }
  if (fields.rentFrequency !== undefined && !schema.rentFrequencyEnum.enumValues.includes(fields.rentFrequency)) {
    throw new ClientError(`Rent frequency must be one of: ${schema.rentFrequencyEnum.enumValues.join(', ')}.`);
  }
  if (fields.depositAmount != null) nonNegativeMoney(fields.depositAmount, 'Deposit amount');
}

export const tenancyRepo = {
  async create(input: TenancyInput): Promise<Tenancy> {
    validateTenancyFields({ ...input, startDate: input.startDate ?? '', rentAmount: input.rentAmount ?? '' });
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
    const existing = await this.get(id);
    if (!existing) return null;
    validateTenancyFields(updates as Partial<TenancyInput>, existing);

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
