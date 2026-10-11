import { NextResponse } from 'next/server';
import { buildFinancialPlan } from '@/lib/planning/engine';
import { InvalidPlanningDataError, InvalidPlanningProfileError, loadPlanningInput } from '@/lib/planning/load';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { input, source, profileSaved } = await loadPlanningInput();
    let plan;
    try {
      plan = buildFinancialPlan(input);
    } catch {
      throw new InvalidPlanningDataError();
    }
    return NextResponse.json({
      status: 'ready',
      profile: input.profile,
      profileSaved,
      source,
      plan,
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof InvalidPlanningDataError) {
      return NextResponse.json({ status: 'unavailable', code: 'LEDGER_VALIDATION_FAILED', error: error.message }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
    }
    if (error instanceof InvalidPlanningProfileError) {
      return NextResponse.json({ status: 'unavailable', code: 'PROFILE_INVALID', error: error.message }, { status: 500 });
    }
    return NextResponse.json({
      status: 'unavailable',
      code: 'DATABASE_UNAVAILABLE',
      error: 'Your financial data is unavailable. Configure DATABASE_URL in environment settings and check the database connection. No balances or recommendations have been substituted.',
    }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
