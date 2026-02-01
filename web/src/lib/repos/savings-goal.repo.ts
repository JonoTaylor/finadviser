import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { savingsGoals } = schema;

export const savingsGoalRepo = {
  async getAll(status?: 'active' | 'completed' | 'cancelled') {
    const db = getDb();
    if (status) {
      return db
        .select()
        .from(savingsGoals)
        .where(eq(savingsGoals.status, status))
        .orderBy(savingsGoals.createdAt);
    }
    return db.select().from(savingsGoals).orderBy(savingsGoals.createdAt);
  },

  async getById(id: number) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(savingsGoals)
      .where(eq(savingsGoals.id, id));
    return row ?? null;
  },

  async create(data: {
    name: string;
    targetAmount: string;
    currentAmount?: string;
    targetDate?: string | null;
    accountId?: number | null;
  }) {
    const db = getDb();
    const [row] = await db
      .insert(savingsGoals)
      .values({
        name: data.name,
        targetAmount: data.targetAmount,
        currentAmount: data.currentAmount ?? '0',
        targetDate: data.targetDate ?? null,
        accountId: data.accountId ?? null,
      })
      .returning();
    return row;
  },

  async update(id: number, data: Partial<{
    name: string;
    targetAmount: string;
    currentAmount: string;
    targetDate: string | null;
    accountId: number | null;
    status: 'active' | 'completed' | 'cancelled';
  }>) {
    const db = getDb();
    const [row] = await db
      .update(savingsGoals)
      .set({ ...data, updatedAt: sql`NOW()` })
      .where(eq(savingsGoals.id, id))
      .returning();
    return row;
  },

  async updateProgress(id: number, amount: string) {
    const db = getDb();
    const [row] = await db
      .update(savingsGoals)
      .set({ currentAmount: amount, updatedAt: sql`NOW()` })
      .where(eq(savingsGoals.id, id))
      .returning();
    return row;
  },

  async remove(id: number) {
    const db = getDb();
    await db.delete(savingsGoals).where(eq(savingsGoals.id, id));
  },
};
