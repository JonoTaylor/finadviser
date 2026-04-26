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
      propertyId?: number | null;
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

    const [je] = await db
      .insert(journalEntries)
      .values({
        date: journal.date,
        description: journal.description,
        reference: journal.reference ?? null,
        categoryId: journal.categoryId ?? null,
        importBatchId: journal.importBatchId ?? null,
        propertyId: journal.propertyId ?? null,
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

  /**
   * Bulk-insert N journals + their book entries in two SQL statements
   * total, regardless of N. Replaces N×3 round-trips (one journal + two
   * book entries each) with two multi-row INSERTs — the difference
   * between a 1,000-row import taking 5 minutes and 5 seconds.
   *
   * Each item must have entries that sum to zero (validated client-side
   * before we hit the DB; the trigger enforces it server-side too).
   * Returns journal IDs in input order.
   */
  async createEntriesBulk(
    items: Array<{
      journal: {
        date: string;
        description: string;
        reference?: string | null;
        categoryId?: number | null;
        importBatchId?: number | null;
        propertyId?: number | null;
      };
      entries: Array<{ accountId: number; amount: string }>;
    }>,
  ): Promise<number[]> {
    if (items.length === 0) return [];
    const db = getDb();

    for (const [i, item] of items.entries()) {
      if (!item.entries || item.entries.length < 2) {
        throw new Error(`Item ${i}: a journal entry requires at least 2 book entries`);
      }
      const total = item.entries.reduce((sum, e) => sum + parseFloat(e.amount), 0);
      if (Math.round(total * 100) !== 0) {
        throw new Error(`Item ${i}: book entries must sum to zero, got ${total}`);
      }
    }

    const journalRows = items.map(item => ({
      date: item.journal.date,
      description: item.journal.description,
      reference: item.journal.reference ?? null,
      categoryId: item.journal.categoryId ?? null,
      importBatchId: item.journal.importBatchId ?? null,
      propertyId: item.journal.propertyId ?? null,
    }));
    const journals = await db
      .insert(journalEntries)
      .values(journalRows)
      .returning({ id: journalEntries.id });

    const bookRows: Array<{ journalEntryId: number; accountId: number; amount: string }> = [];
    items.forEach((item, i) => {
      for (const entry of item.entries) {
        bookRows.push({
          journalEntryId: journals[i].id,
          accountId: entry.accountId,
          amount: entry.amount,
        });
      }
    });
    if (bookRows.length > 0) {
      await db.insert(bookEntries).values(bookRows);
    }

    return journals.map(j => j.id);
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

  /**
   * Months that still have one or more uncategorised journal entries,
   * with the count for each. Used by the AI workflow to find where
   * categorisation work is needed and pick the next month to review.
   */
  async listMonthsNeedingCategorization(): Promise<Array<{ month: string; uncategorizedCount: number }>> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT to_char(date::date, 'YYYY-MM') AS month, COUNT(*)::int AS uncategorized_count
      FROM journal_entries
      WHERE category_id IS NULL
      GROUP BY to_char(date::date, 'YYYY-MM')
      ORDER BY month DESC
    `);
    return rows.rows.map(r => ({
      month: r.month as string,
      uncategorizedCount: r.uncategorized_count as number,
    }));
  },

  /**
   * All uncategorised journal entries within a YYYY-MM window, with
   * the same `entries_summary` shape as `listUncategorizedWithAmounts`.
   * The AI categorisation workflow uses this when it picks a month to
   * review.
   */
  async listUncategorizedInMonth(month: string, limit = 200): Promise<Array<{ id: number; date: string; description: string; entries_summary: string | null }>> {
    const db = getDb();
    const rows = await db.execute(sql`
      SELECT je.id, je.date, je.description,
             STRING_AGG(a.name || ':' || be.amount, '|' ORDER BY CASE a.account_type WHEN 'ASSET' THEN 0 ELSE 1 END) AS entries_summary
      FROM journal_entries je
      LEFT JOIN book_entries be ON be.journal_entry_id = je.id
      LEFT JOIN accounts a ON a.id = be.account_id
      WHERE je.category_id IS NULL
        AND to_char(je.date::date, 'YYYY-MM') = ${month}
      GROUP BY je.id, je.date, je.description
      ORDER BY je.date ASC, je.id ASC
      LIMIT ${limit}
    `);
    return rows.rows as Array<{ id: number; date: string; description: string; entries_summary: string | null }>;
  },

  /**
   * Apply a category to many journal entries in one statement using a
   * CASE expression keyed on the journal id. Single round-trip
   * regardless of N — important when the AI commits a batch of dozens
   * of categorisations at once.
   */
  async updateCategoryBulk(items: Array<{ journalId: number; categoryId: number }>): Promise<number> {
    if (items.length === 0) return 0;
    const db = getDb();
    const ids = items.map(i => i.journalId);
    // Build the CASE WHEN safely using the sql tagged template.
    const cases = sql.join(
      items.map(i => sql`WHEN ${i.journalId} THEN ${i.categoryId}`),
      sql` `,
    );
    const result = await db.execute(sql`
      UPDATE journal_entries
         SET category_id = CASE id ${cases} END
       WHERE id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
    `);
    return result.rowCount ?? 0;
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
