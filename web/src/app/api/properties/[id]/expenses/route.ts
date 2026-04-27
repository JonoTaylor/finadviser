import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { recordPropertyExpense } from '@/lib/properties/property-expense';
import { ClientError } from '@/lib/errors';

/**
 * GET /api/properties/[id]/expenses?limit=50
 *
 * Returns recent property-tagged expense journal entries for the
 * property page. One row per journal: date, description, category
 * name, expense amount (the EXPENSE-side debit, sign-preserved so
 * refunds appear negative), the source account (Bank, Cash, etc).
 *
 * Mortgage interest journals are filtered OUT here - they have
 * their own dedicated card (MortgageInterestSummary) and counting
 * them in the expenses list would double-count on the dashboard.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;

    const db = getDb();
    const rows = await db.execute(sql`
      SELECT je.id           AS journal_id,
             je.date         AS date,
             je.description  AS description,
             c.name          AS category,
             a.name          AS account,
             a.is_system     AS account_is_system,
             be.amount::numeric AS amount
        FROM journal_entries je
        JOIN book_entries be ON be.journal_entry_id = je.id
        JOIN accounts a      ON a.id = be.account_id
        LEFT JOIN categories c ON c.id = je.category_id
       WHERE je.property_id = ${propertyId}
         AND a.account_type = 'EXPENSE'
         AND NOT (a.is_system AND a.name = 'Mortgage Interest')
       ORDER BY je.date DESC, je.id DESC
       LIMIT ${limit}
    `);

    const expenses = rows.rows.map(r => ({
      journalId: r.journal_id as number,
      date: r.date as string,
      description: r.description as string,
      category: (r.category as string | null) ?? null,
      account: r.account as string,
      amount: String(r.amount),
    }));

    return NextResponse.json({ expenses, count: expenses.length, limit });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load expenses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    const body = await request.json();
    if (!body.date || !body.amount || !body.fromAccountId) {
      return NextResponse.json(
        { error: 'date, amount, and fromAccountId are required' },
        { status: 400 },
      );
    }

    const fromAccountId = parseInt(body.fromAccountId, 10);
    if (Number.isNaN(fromAccountId)) {
      return NextResponse.json({ error: 'Invalid fromAccountId' }, { status: 400 });
    }

    const categoryId = body.categoryId ? parseInt(body.categoryId, 10) : null;
    if (categoryId !== null && Number.isNaN(categoryId)) {
      return NextResponse.json({ error: 'Invalid categoryId' }, { status: 400 });
    }

    const journalId = await recordPropertyExpense({
      propertyId,
      date: body.date,
      amount: body.amount,
      fromAccountId,
      categoryId,
      description: body.description,
      reference: body.reference ?? null,
    });

    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to record expense';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
