import { NextRequest, NextResponse } from 'next/server';
import { recordMortgagePayment } from '@/lib/properties/mortgage-tracker';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const body = await request.json();
    const journalId = await recordMortgagePayment({
      mortgageId: body.mortgageId,
      paymentDate: body.paymentDate,
      totalAmount: body.totalAmount,
      principalAmount: body.principalAmount,
      interestAmount: body.interestAmount,
      payerOwnerId: body.payerOwnerId,
      fromAccountId: body.fromAccountId,
    });
    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record payment';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
