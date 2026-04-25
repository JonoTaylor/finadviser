import { NextRequest, NextResponse } from 'next/server';
import { recordPropertyExpense } from '@/lib/properties/property-expense';
import { ClientError } from '@/lib/errors';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    const body = await request.json();
    if (!body.date || !body.amount || !body.fromAccountId) {
      return NextResponse.json(
        { error: 'date, amount, and fromAccountId are required' },
        { status: 400 },
      );
    }

    const journalId = await recordPropertyExpense({
      propertyId,
      date: body.date,
      amount: body.amount,
      fromAccountId: parseInt(body.fromAccountId, 10),
      categoryId: body.categoryId ? parseInt(body.categoryId, 10) : null,
      description: body.description,
      reference: body.reference ?? null,
    });

    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to record expense';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
