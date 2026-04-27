import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { accounts, bookEntries } = schema;

export const accountRepo = {
  async create(data: {
    name: string;
    accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';
    parentId?: number | null;
    description?: string | null;
    isSystem?: boolean;
    isInvestment?: boolean;
    investmentKind?: string | null;
    ownerId?: number | null;
  }) {
    const db = getDb();
    const [row] = await db
      .insert(accounts)
      .values({
        name: data.name,
        accountType: data.accountType,
        parentId: data.parentId ?? null,
        description: data.description ?? null,
        isSystem: data.isSystem ?? false,
        isInvestment: data.isInvestment ?? false,
        investmentKind: data.investmentKind ?? null,
        ownerId: data.ownerId ?? null,
      })
      .returning();
    return row;
  },

  async listInvestments() {
    const db = getDb();
    return db
      .select()
      .from(accounts)
      .where(eq(accounts.isInvestment, true))
      .orderBy(accounts.name);
  },

  async update(id: number, patch: Partial<{
    name: string;
    description: string | null;
    isInvestment: boolean;
    investmentKind: string | null;
    ownerId: number | null;
  }>) {
    const db = getDb();
    const updates: Record<string, unknown> = {};
    if (patch.name !== undefined) updates.name = patch.name;
    if (patch.description !== undefined) updates.description = patch.description;
    if (patch.isInvestment !== undefined) updates.isInvestment = patch.isInvestment;
    if (patch.investmentKind !== undefined) updates.investmentKind = patch.investmentKind;
    if (patch.ownerId !== undefined) updates.ownerId = patch.ownerId;
    if (Object.keys(updates).length === 0) return this.getById(id);
    const [row] = await db
      .update(accounts)
      .set(updates)
      .where(eq(accounts.id, id))
      .returning();
    return row ?? null;
  },

  async getById(id: number) {
    const db = getDb();
    const [row] = await db.select().from(accounts).where(eq(accounts.id, id));
    return row ?? null;
  },

  async getByName(name: string) {
    const db = getDb();
    const [row] = await db.select().from(accounts).where(eq(accounts.name, name));
    return row ?? null;
  },

  async getOrCreate(
    name: string,
    accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE',
    description?: string | null,
  ) {
    const existing = await accountRepo.getByName(name);
    if (existing) return existing;
    return accountRepo.create({ name, accountType, description });
  },

  async listAll() {
    const db = getDb();
    return db.select().from(accounts).orderBy(accounts.accountType, accounts.name);
  },

  async listByType(accountType: 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE') {
    const db = getDb();
    return db
      .select()
      .from(accounts)
      .where(eq(accounts.accountType, accountType))
      .orderBy(accounts.name);
  },

  async getBalances() {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM v_account_balances`);
    return rows.rows as Array<{
      account_id: number;
      account_name: string;
      account_type: string;
      balance: string;
    }>;
  },

  async getBalance(accountId: number): Promise<string> {
    const db = getDb();
    const [row] = await db
      .select({ balance: sql<string>`COALESCE(SUM(${bookEntries.amount}::numeric), 0)` })
      .from(bookEntries)
      .where(eq(bookEntries.accountId, accountId));
    return row?.balance ?? '0';
  },
};
