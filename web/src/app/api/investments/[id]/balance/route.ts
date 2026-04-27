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

    try {
      const result = await setInvestmentBalance({
        accountId,
        newBalance: newBalance.trim(),
        asOfDate,
        description: typeof body.description === 'string' ? body.description : undefined,
      });
      return NextResponse.json({ accountId, ...result, asOfDate });
    } catch (error) {
      // Map known client-fault errors thrown by setInvestmentBalance
      // to 400/404 so the UI / AI tool can distinguish bad input
      // from server failure. The "Investment Adjustments missing"
      // case stays a 500 — that's a deploy-time DB issue, not user
      // input.
      const message = error instanceof Error ? error.message : 'Failed to update balance';
      if (message.startsWith('Account ') && message.includes('not found')) {
        return NextResponse.json({ error: message }, { status: 404 });
      }
      if (message.includes('not flagged as an investment') ||
          message.includes('Investment accounts must be ASSET type')) {
        return NextResponse.json({ error: message }, { status: 400 });
      }
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update balance';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
