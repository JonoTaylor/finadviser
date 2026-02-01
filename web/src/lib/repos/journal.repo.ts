import { eq, sql, and, gte, lte, desc } from 'drizzle-orm';
import { getDb, schema } from '@/lib/db';

const { journalEntries, bookEntries, categories, accounts } = schema;

export const journalRepo = {
  async createEntry(
    journal: {
      date: string;
      description: string;
      reference?: string | null;
      categoryId?: number | null;
      importBatchId?: number | null;
    },
    entries: Array<{ accountId: number; amount: string }>,
  ): Promise<number> {
    const db = getDb();
    if (!entries || entries.length < 2) {
      throw new Error('A journal entry requires at least 2 book entries');
    }

    const total = entries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
    if (Math.round(total * 100) !== 0) {
      throw new Error(`Book entries must sum to zero, got ${total}`);
    }

    // Insert journal entry
    const [je] = await db
      .insert(journalEntries)
      .values({
        date: journal.date,
        description: journal.description,
        reference: journal.reference ?? null,
        categoryId: journal.categoryId ?? null,
        importBatchId: journal.importBatchId ?? null,
      })
      .returning();

    // Insert book entries
    for (const entry of entries) {
      await db.insert(bookEntries).values({
        journalEntryId: je.id,
        accountId: entry.accountId,
        amount: entry.amount,
      });
    }

    return je.id;
  },

  async getEntry(journalId: number) {
    const db = getDb();
    const [row] = await db
      .select()
      .from(journalEntries)
      .where(eq(journalEntries.id, journalId));
    return row ?? null;
  },

  async getBookEntries(journalId: number) {
    const db = getDb();
    return db
      .select()
      .from(bookEntries)
      .where(eq(bookEntries.journalEntryId, journalId));
  },

  async listEntries(filters: {
    startDate?: string;
    endDate?: string;
    categoryId?: number;
    accountId?: number;
    query?: string;
    limit?: number;
    offset?: number;
  } = {}) {
    const db = getDb();
    const { startDate, endDate, categoryId, accountId, query, limit = 100, offset = 0 } = filters;

    let whereClause = sql`1=1`;
    if (startDate) whereClause = sql`${whereClause} AND je.date >= ${startDate}`;
    if (endDate) whereClause = sql`${whereClause} AND je.date <= ${endDate}`;
    if (categoryId !== undefined) whereClause = sql`${whereClause} AND je.category_id = ${categoryId}`;
    if (accountId !== undefined) {
      whereClause = sql`${whereClause} AND je.id IN (SELECT journal_entry_id FROM book_entries WHERE account_id = ${accountId})`;
    }
    if (query) whereClause = sql`${whereClause} AND je.description ILIKE ${'%' + query + '%'}`;

    const rows = await db.execute(sql`
      SELECT je.id, je.date, je.description, je.reference, je.category_id,
             c.name AS category_name,
             STRING_AGG(a.name || ':' || be.amount, '|' ORDER BY CASE a.account_type WHEN 'ASSET' THEN 0 ELSE 1 END) AS entries_summary
      FROM journal_entries je
      LEFT JOIN categories c ON c.id = je.category_id
      LEFT JOIN book_entries be ON be.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = be.account_id
      WHERE ${whereClause}
      GROUP BY je.id, je.date, je.description, je.reference, je.category_id, c.name
      ORDER BY je.date DESC, je.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `);
    return rows.rows;
  },

  async countEntries(filters: {
    startDate?: string;
    endDate?: string;
    categoryId?: number;
    accountId?: number;
    query?: string;
  } = {}) {
    const db = getDb();
    const { startDate, endDate, categoryId, accountId, query } = filters;

    let whereClause = sql`1=1`;
    if (startDate) whereClause = sql`${whereClause} AND je.date >= ${startDate}`;
    if (endDate) whereClause = sql`${whereClause} AND je.date <= ${endDate}`;
    if (categoryId !== undefined) whereClause = sql`${whereClause} AND je.category_id = ${categoryId}`;
    if (accountId !== undefined) {
      whereClause = sql`${whereClause} AND je.id IN (SELECT journal_entry_id FROM book_entries WHERE account_id = ${accountId})`;
    }
    if (query) whereClause = sql`${whereClause} AND je.description ILIKE ${'%' + query + '%'}`;

    const rows = await db.execute(sql`
      SELECT COUNT(DISTINCT je.id) AS count
      FROM journal_entries je
      WHERE ${whereClause}
    `);
    return parseInt(rows.rows[0]?.count as string ?? '0', 10);
  },

  async updateCategory(journalId: number, categoryId: number) {
    const db = getDb();
    await db
      .update(journalEntries)
      .set({ categoryId })
      .where(eq(journalEntries.id, journalId));
  },

  async getMonthlySpending() {
    const db = getDb();
    const rows = await db.execute(sql`SELECT * FROM v_monthly_spending`);
    return rows.rows as Array<{
      month: string;
      category_name: string | null;
      account_type: string;
      total: string;
    }>;
  },

  async listUncategorized(limit = 500) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT id, description
      FROM journal_entries
      WHERE category_id IS NULL
      ORDER BY date DESC
      LIMIT ${limit}
    `);
    return rows.rows as Array<{ id: number; description: string }>;
  },

  async listUncategorizedWithAmounts(limit = 25) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT je.id, je.date, je.description,
             STRING_AGG(a.name || ':' || be.amount, '|' ORDER BY CASE a.account_type WHEN 'ASSET' THEN 0 ELSE 1 END) AS entries_summary
      FROM journal_entries je
      LEFT JOIN book_entries be ON be.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = be.account_id
      WHERE je.category_id IS NULL
      GROUP BY je.id, je.date, je.description
      ORDER BY je.date DESC
      LIMIT ${limit}
    `);
    return rows.rows as Array<{ id: number; date: string; description: string; entries_summary: string | null }>;
  },

  async search(query: string, limit = 50) {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT je.id, je.date, je.description, je.category_id, c.name AS category_name,
             STRING_AGG(a.name || ':' || be.amount, '|' ORDER BY CASE a.account_type WHEN 'ASSET' THEN 0 ELSE 1 END) AS entries_summary
      FROM journal_entries je
      LEFT JOIN categories c ON c.id = je.category_id
      LEFT JOIN book_entries be ON be.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = be.account_id
      WHERE je.description ILIKE ${'%' + query + '%'}
      GROUP BY je.id, je.date, je.description, je.category_id, c.name
      ORDER BY je.date DESC
      LIMIT ${limit}
    `);
    return rows.rows;
  },
};
