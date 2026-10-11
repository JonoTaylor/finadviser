import { NextRequest, NextResponse } from 'next/server';
import { budgetRepo } from '@/lib/repos';
import { budgetBodySchema, financialPlanValidationError } from '@/lib/validation/financial-plans';

export async function GET() {
  try {
    const budgets = await budgetRepo.getAll();
    return NextResponse.json(budgets);
  } catch {
    return NextResponse.json({ error: 'Budgets are temporarily unavailable' }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = budgetBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: financialPlanValidationError(parsed.error) }, { status: 400 });
    }
    const { categoryId, monthlyLimit, effectiveFrom } = parsed.data;
    const budget = await budgetRepo.upsert(categoryId, monthlyLimit, effectiveFrom);
    return NextResponse.json(budget);
  } catch {
    return NextResponse.json({ error: 'Failed to save budget' }, { status: 500 });
  }
}
