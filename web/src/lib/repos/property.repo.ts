import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const {
  properties,
  owners,
  propertyOwnership,
  propertyValuations,
  mortgages,
  mortgageRateHistory,
  expenseAllocationRules,
  bookEntries,
  accounts,
  propertyTransfers,
} = schema;

export const propertyRepo = {
  async createProperty(data: {
    name: string;
    address?: string | null;
    purchaseDate?: string | null;
    purchasePrice?: string | null;
  }) {
    const db = getDb();
    const [row] = await db
      .insert(properties)
      .values({
        name: data.name,
        address: data.address ?? null,
        purchaseDate: data.purchaseDate ?? null,
        purchasePrice: data.purchasePrice ?? null,
      })
      .returning();
    return row;
  },

  async getProperty(id: number) {
    const db = getDb();
    const [row] = await db.select().from(properties).where(eq(properties.id, id));
    return row ?? null;
  },

  async listProperties() {
    const db = getDb();
    return db.select().from(properties).orderBy(properties.name);
  },

  async createOwner(name: string) {
    const db = getDb();
    // Try insert, on conflict return existing
    const existing = await db.select().from(owners).where(eq(owners.name, name));
    if (existing.length > 0) return existing[0];
    const [row] = await db.insert(owners).values({ name }).returning();
    return row;
  },

  async getOwner(id: number) {
    const db = getDb();
    const [row] = await db.select().from(owners).where(eq(owners.id, id));
    return row ?? null;
  },

  async listOwners() {
    const db = getDb();
    return db.select().from(owners).orderBy(owners.name);
  },

  async addOwnership(propertyId: number, ownerId: number, capitalAccountId: number) {
    const db = getDb();
    const [row] = await db
      .insert(propertyOwnership)
      .values({ propertyId, ownerId, capitalAccountId })
      .returning();
    return row;
  },

  async getOwnership(propertyId: number) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT po.*, o.name AS owner_name, a.name AS account_name
      FROM property_ownership po
      JOIN owners o ON o.id = po.owner_id
      JOIN accounts a ON a.id = po.capital_account_id
      WHERE po.property_id = ${propertyId}
    `);
    return rows.rows;
  },

  async addValuation(propertyId: number, valuation: string, valuationDate: string, source = 'manual') {
    const db = getDb();
    const [row] = await db
      .insert(propertyValuations)
      .values({ propertyId, valuation, valuationDate, source })
      .returning();
    return row;
  },

  async getLatestValuation(propertyId: number) {
    const db = getDb();
    const rows = await db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, propertyId))
      .orderBy(sql`valuation_date DESC`)
      .limit(1);
    return rows[0] ?? null;
  },

  async getValuations(propertyId: number) {
    const db = getDb();
    return db
      .select()
      .from(propertyValuations)
      .where(eq(propertyValuations.propertyId, propertyId))
      .orderBy(sql`valuation_date DESC`);
  },

  async createMortgage(data: {
    propertyId: number;
    lender: string;
    originalAmount: string;
    startDate: string;
    termMonths: number;
    liabilityAccountId: number;
  }) {
    const db = getDb();
    const [row] = await db.insert(mortgages).values(data).returning();
    return row;
  },

  async getMortgages(propertyId: number) {
    const db = getDb();
    return db
      .select()
      .from(mortgages)
      .where(eq(mortgages.propertyId, propertyId))
      .orderBy(mortgages.startDate);
  },

  async addMortgageRate(mortgageId: number, rate: string, effectiveDate: string) {
    const db = getDb();
    const [row] = await db
      .insert(mortgageRateHistory)
      .values({ mortgageId, rate, effectiveDate })
      .returning();
    return row;
  },

  async getMortgageBalance(mortgageId: number): Promise<string> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT COALESCE(SUM(be.amount::numeric), 0) AS balance
      FROM book_entries be
      JOIN mortgages m ON m.liability_account_id = be.account_id
      WHERE m.id = ${mortgageId}
    `);
    return rows.rows[0]?.balance as string ?? '0';
  },

  async getEquityView(propertyId: number) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT * FROM v_property_equity WHERE property_id = ${propertyId}
    `);
    return rows.rows;
  },

  async getAllocationRules(propertyId: number) {
    const db = getDb();
    return db
      .select()
      .from(expenseAllocationRules)
      .where(eq(expenseAllocationRules.propertyId, propertyId));
  },

  async setAllocationRule(propertyId: number, ownerId: number, pct: string, expenseType = 'all') {
    const db = getDb();
    await db.execute(sql`
      INSERT INTO expense_allocation_rules (property_id, owner_id, allocation_pct, expense_type)
      VALUES (${propertyId}, ${ownerId}, ${pct}, ${expenseType})
      ON CONFLICT (property_id, owner_id, expense_type) DO UPDATE SET allocation_pct = EXCLUDED.allocation_pct
    `);
  },

  async getTransfers(propertyId?: number, ownerId?: number) {
    const db = getDb();
    let whereClause = sql`1=1`;
    if (propertyId !== undefined) {
      whereClause = sql`${whereClause} AND (pt.from_property_id = ${propertyId} OR pt.to_property_id = ${propertyId})`;
    }
    if (ownerId !== undefined) {
      whereClause = sql`${whereClause} AND pt.owner_id = ${ownerId}`;
    }

    const rows = await db.execute(sql`
      SELECT pt.*, fp.name AS from_property, tp.name AS to_property, o.name AS owner_name
      FROM property_transfers pt
      JOIN properties fp ON fp.id = pt.from_property_id
      JOIN properties tp ON tp.id = pt.to_property_id
      JOIN owners o ON o.id = pt.owner_id
      WHERE ${whereClause}
      ORDER BY pt.transfer_date DESC
    `);
    return rows.rows;
  },

  async createTransfer(data: {
    fromPropertyId: number;
    toPropertyId: number;
    ownerId: number;
    amount: string;
    journalEntryId: number;
    transferDate: string;
    description?: string | null;
  }) {
    const db = getDb();
    const [row] = await db
      .insert(propertyTransfers)
      .values({
        fromPropertyId: data.fromPropertyId,
        toPropertyId: data.toPropertyId,
        ownerId: data.ownerId,
        amount: data.amount,
        journalEntryId: data.journalEntryId,
        transferDate: data.transferDate,
        description: data.description ?? null,
      })
      .returning();
    return row;
  },
};
