import { NextRequest, NextResponse } from 'next/server';
import { calculateEquity } from '@/lib/properties/equity-calculator';
import { parseId, routeErrorResponse } from '@/lib/http/route-errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const equityData = await calculateEquity(parseId(id, 'property id'));
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
    return routeErrorResponse(error, 'Failed to calculate equity');
  }
}
