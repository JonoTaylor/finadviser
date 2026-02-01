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
      })
      .returning();
    return row;
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
