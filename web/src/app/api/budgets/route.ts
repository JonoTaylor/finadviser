import { NextRequest, NextResponse } from 'next/server';
import { budgetRepo } from '@/lib/repos';

export async function GET() {
  try {
    const budgets = await budgetRepo.getAll();
    return NextResponse.json(budgets);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { categoryId, monthlyLimit, effectiveFrom } = body;
    if (!categoryId || !monthlyLimit || !effectiveFrom) {
      return NextResponse.json(
        { error: 'categoryId, monthlyLimit, and effectiveFrom are required' },
        { status: 400 },
      );
    }
    const budget = await budgetRepo.upsert(categoryId, monthlyLimit, effectiveFrom);
    return NextResponse.json(budget);
  } catch {
    return NextResponse.json({ error: 'Failed to save budget' }, { status: 500 });
  }
}
