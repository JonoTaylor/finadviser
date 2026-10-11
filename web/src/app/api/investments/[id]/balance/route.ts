import { NextRequest, NextResponse } from 'next/server';
import { setInvestmentBalance } from '@/lib/properties/personal-net-worth';
import { londonTodayIso } from '@/lib/dates/today';
import { ClientError } from '@/lib/errors';
import { investmentBalanceBodySchema } from '@/lib/validation/investment-balance';
import { financialPlanValidationError } from '@/lib/validation/financial-plans';

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
    const accountId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isInteger(accountId) || accountId <= 0 || accountId > 2147483647) {
      return NextResponse.json({ error: 'Invalid account id' }, { status: 400 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = investmentBalanceBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: financialPlanValidationError(parsed.error) }, { status: 400 });
    }
    const { newBalance, description } = parsed.data;
    const asOfDate = parsed.data.asOfDate ?? londonTodayIso();

    try {
      const result = await setInvestmentBalance({
        accountId,
        newBalance,
        asOfDate,
        description,
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
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to update balance';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
