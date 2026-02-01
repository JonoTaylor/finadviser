import { NextRequest, NextResponse } from 'next/server';
import { savingsGoalRepo } from '@/lib/repos';

export async function GET() {
  try {
    const goals = await savingsGoalRepo.getAll();
    return NextResponse.json(goals);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, targetAmount, targetDate, accountId } = body;
    if (!name || !targetAmount) {
      return NextResponse.json(
        { error: 'name and targetAmount are required' },
        { status: 400 },
      );
    }
    const goal = await savingsGoalRepo.create({
      name,
      targetAmount,
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
    const body = await request.json();
    const { id, ...data } = body;
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    const goal = await savingsGoalRepo.update(id, data);
    return NextResponse.json(goal);
  } catch {
    return NextResponse.json({ error: 'Failed to update goal' }, { status: 500 });
  }
}
