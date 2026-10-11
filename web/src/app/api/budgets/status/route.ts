import { NextRequest, NextResponse } from 'next/server';
import { budgetRepo } from '@/lib/repos';
import { londonTodayIso } from '@/lib/dates/today';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? londonTodayIso().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return NextResponse.json({ error: 'Invalid budget month: expected YYYY-MM' }, { status: 400 });
    }
    const status = await budgetRepo.getStatusForMonth(month);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json({ error: 'Budget status is temporarily unavailable' }, { status: 503 });
  }
}
