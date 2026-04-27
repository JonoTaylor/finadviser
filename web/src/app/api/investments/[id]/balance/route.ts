import { NextRequest, NextResponse } from 'next/server';
import { setInvestmentBalance } from '@/lib/properties/personal-net-worth';
import { londonTodayIso } from '@/lib/dates/today';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/investments/[id]/balance
 * Body: { newBalance: string, asOfDate?: 'YYYY-MM-DD' }
 *
 * Records the new balance via a journal entry that DRs/CRs this
 * investment account by the delta and offsets to the system
 * "Investment Adjustments" equity account. v_account_balances picks
 * up the new value immediately.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const accountId = parseInt(id, 10);
    if (Number.isNaN(accountId)) {
      return NextResponse.json({ error: 'Invalid account id' }, { status: 400 });
    }
    const body = (await request.json().catch(() => ({}))) || {};
    const newBalance = body.newBalance;
    if (typeof newBalance !== 'string' || newBalance.trim().length === 0) {
      return NextResponse.json({ error: 'newBalance is required (decimal string)' }, { status: 400 });
    }
    if (!/^-?\d+(\.\d+)?$/.test(newBalance.trim())) {
      return NextResponse.json({ error: 'newBalance must be a decimal number string' }, { status: 400 });
    }

    let asOfDate = londonTodayIso();
    if (body.asOfDate !== undefined) {
      if (typeof body.asOfDate !== 'string' || !ISO_DATE.test(body.asOfDate)) {
        return NextResponse.json({ error: 'asOfDate must be YYYY-MM-DD' }, { status: 400 });
      }
      asOfDate = body.asOfDate;
    }

    const result = await setInvestmentBalance({
      accountId,
      newBalance: newBalance.trim(),
      asOfDate,
      description: typeof body.description === 'string' ? body.description : undefined,
    });
    return NextResponse.json({ accountId, ...result, asOfDate });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update balance';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
