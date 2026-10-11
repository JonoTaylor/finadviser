import { NextRequest, NextResponse } from 'next/server';
import { savingsGoalRepo } from '@/lib/repos';
import {
  savingsGoalBodySchema,
  savingsGoalPatchSchema,
  financialPlanValidationError,
} from '@/lib/validation/financial-plans';

export async function GET() {
  try {
    const goals = await savingsGoalRepo.getAll();
    return NextResponse.json(goals);
  } catch {
    return NextResponse.json({ error: 'Savings goals are temporarily unavailable' }, { status: 503 });
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
    const parsed = savingsGoalBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: financialPlanValidationError(parsed.error) }, { status: 400 });
    }
    const { name, targetAmount, currentAmount, targetDate, accountId } = parsed.data;
    const goal = await savingsGoalRepo.create({
      name,
      targetAmount,
      currentAmount,
      targetDate: targetDate ?? null,
      accountId: accountId ?? null,
    });
    return NextResponse.json(goal);
  } catch {
    return NextResponse.json({ error: 'Failed to create goal' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = savingsGoalPatchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: financialPlanValidationError(parsed.error) }, { status: 400 });
    }
    const { id, ...data } = parsed.data;
    const goal = await savingsGoalRepo.update(id, data);
    if (!goal) return NextResponse.json({ error: 'Savings goal not found' }, { status: 404 });
    return NextResponse.json(goal);
  } catch {
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
