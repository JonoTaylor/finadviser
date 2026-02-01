import { eq, sql } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { budgets } = schema;

export const budgetRepo = {
  async getAll() {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT b.id, b.category_id, b.monthly_limit, b.effective_from,
             b.created_at, b.updated_at, c.name AS category_name
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      ORDER BY c.name
    `);
    return rows.rows as Array<{
      id: number;
      category_id: number;
      monthly_limit: string;
      effective_from: string;
      created_at: string;
      updated_at: string;
      category_name: string;
    }>;
  },

  async getByCategory(categoryId: number) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(budgets)
      .where(eq(budgets.categoryId, categoryId));
    return row ?? null;
  },

  async upsert(categoryId: number, monthlyLimit: string, effectiveFrom: string) {
    const db = getDb();
    const rows = await db.execute(sql`
      INSERT INTO budgets (category_id, monthly_limit, effective_from, updated_at)
      VALUES (${categoryId}, ${monthlyLimit}, ${effectiveFrom}, NOW())
      ON CONFLICT (category_id) DO UPDATE SET
        monthly_limit = EXCLUDED.monthly_limit,
        effective_from = EXCLUDED.effective_from,
        updated_at = NOW()
      RETURNING *
    `);
    return rows.rows[0] as {
      id: number;
      category_id: number;
      monthly_limit: string;
      effective_from: string;
    };
  },

  async remove(id: number) {
    const db = getDb();
    await db.delete(budgets).where(eq(budgets.id, id));
  },

  async getStatusForMonth(month: string) {
    const db = getDb();
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    const rows = await db.execute(sql`
      SELECT
        b.id AS budget_id,
        b.category_id,
        c.name AS category_name,
        b.monthly_limit,
        COALESCE(ABS(SUM(
          CASE WHEN je.date >= ${startDate} AND je.date <= ${endDate}
          THEN be.amount ELSE 0 END
        )), 0)::text AS spent
      FROM budgets b
      JOIN categories c ON c.id = b.category_id
      LEFT JOIN journal_entries je ON je.category_id = b.category_id
      LEFT JOIN book_entries be ON be.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = be.account_id AND a.account_type = 'EXPENSE'
      GROUP BY b.id, b.category_id, c.name, b.monthly_limit
      ORDER BY c.name
    `);

    return rows.rows as Array<{
      budget_id: number;
      category_id: number;
      category_name: string;
      monthly_limit: string;
      spent: string;
    }>;
  },
};
