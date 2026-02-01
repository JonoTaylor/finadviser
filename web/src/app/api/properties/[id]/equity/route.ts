import { NextRequest, NextResponse } from 'next/server';
import { calculateEquity } from '@/lib/properties/equity-calculator';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const equityData = await calculateEquity(parseInt(id));
    const serialized = equityData.map(e => ({
      ownerId: e.ownerId,
      name: e.name,
      capitalAccountId: e.capitalAccountId,
      capitalBalance: e.capitalBalance.toString(),
      equityPct: e.equityPct,
      equityAmount: e.equityAmount.toString(),
    }));
    return NextResponse.json(serialized);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to calculate equity' }, { status: 500 });
  }
}
