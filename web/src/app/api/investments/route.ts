import { NextRequest, NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { accountRepo, propertyRepo } from '@/lib/repos';

const VALID_KINDS = ['pension', 'isa', 'lisa', 'savings', 'crypto', 'other'] as const;
type InvestmentKind = typeof VALID_KINDS[number];

/**
 * Investment accounts — ASSET accounts flagged is_investment=true.
 * Includes pension / S&S ISA / LISA / cash savings / crypto / other.
 * Owner-attributed (an ISA belongs to one person, never both).
 */
export async function GET() {
  try {
    const db = getDb();
    // Single query joining accounts + the v_account_balances view
    // (single source of truth for balance arithmetic) so we don't
    // re-implement the SUM(book_entries.amount) here.
    const rows = await db.execute(sql`
      SELECT a.id, a.name, a.investment_kind, a.owner_id,
             o.name AS owner_name,
             COALESCE(v.balance, 0) AS balance
      FROM accounts a
      LEFT JOIN owners o ON o.id = a.owner_id
      LEFT JOIN v_account_balances v ON v.account_id = a.id
      WHERE a.is_investment = true
      ORDER BY a.name
    `);
    return NextResponse.json(rows.rows.map(r => ({
      id: r.id,
      name: r.name,
      investmentKind: r.investment_kind,
      ownerId: r.owner_id,
      ownerName: r.owner_name,
      balance: r.balance,
    })));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list investments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) || {};
    if (typeof body.name !== 'string' || body.name.trim().length === 0) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    const ownerId = Number(body.ownerId);
    if (!Number.isFinite(ownerId)) {
      return NextResponse.json({ error: 'ownerId is required' }, { status: 400 });
    }
    const owner = await propertyRepo.getOwner(ownerId);
    if (!owner) {
      return NextResponse.json({ error: 'Owner not found' }, { status: 404 });
    }
    const investmentKind = typeof body.investmentKind === 'string' ? body.investmentKind : null;
    if (investmentKind !== null && !VALID_KINDS.includes(investmentKind as InvestmentKind)) {
      return NextResponse.json({
        error: `investmentKind must be one of: ${VALID_KINDS.join(', ')}`,
      }, { status: 400 });
    }

    const account = await accountRepo.create({
      name: body.name.trim(),
      accountType: 'ASSET',
      isInvestment: true,
      investmentKind,
      ownerId,
      description: typeof body.description === 'string' ? body.description : null,
    });
    return NextResponse.json(account, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create investment';
    // Most likely failure is the unique constraint on `name` —
    // surface that as a 409 with a helpful message.
    if (message.includes('duplicate key') || message.includes('unique')) {
      return NextResponse.json({ error: 'An account with that name already exists' }, { status: 409 });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
