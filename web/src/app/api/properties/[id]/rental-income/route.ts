import { NextRequest, NextResponse } from 'next/server';
import { recordRentalIncome } from '@/lib/properties/rental-income';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });

    const body = await request.json();
    if (!body.date || !body.amount || !body.toAccountId) {
      return NextResponse.json(
        { error: 'date, amount, and toAccountId are required' },
        { status: 400 },
      );
    }

    const journalId = await recordRentalIncome({
      propertyId,
      date: body.date,
      amount: body.amount,
      toAccountId: parseInt(body.toAccountId, 10),
      description: body.description,
      tenancyId: body.tenancyId ? parseInt(body.tenancyId, 10) : null,
    });

    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record rental income';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
