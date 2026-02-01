import { NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await journalRepo.getMonthlySpending();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch monthly spending' }, { status: 500 });
  }
}
