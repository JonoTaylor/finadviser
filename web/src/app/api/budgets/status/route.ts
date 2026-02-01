import { NextRequest, NextResponse } from 'next/server';
import { budgetRepo } from '@/lib/repos';
import { format } from 'date-fns';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const month = searchParams.get('month') ?? format(new Date(), 'yyyy-MM');
    const status = await budgetRepo.getStatusForMonth(month);
    return NextResponse.json(status);
  } catch {
    return NextResponse.json([]);
  }
}
