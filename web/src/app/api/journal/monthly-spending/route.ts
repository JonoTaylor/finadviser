import { NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const data = await journalRepo.getMonthlySpending();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch monthly spending');
  }
}
