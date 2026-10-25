import { NextRequest, NextResponse } from 'next/server';
import { transferEquity } from '@/lib/properties/transfer-engine';
import { propertyRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

export async function GET(request: NextRequest) {
  try {
    const propertyId = request.nextUrl.searchParams.get('propertyId');
    const ownerId = request.nextUrl.searchParams.get('ownerId');
    const transfers = await propertyRepo.getTransfers(
      propertyId ? parseInt(propertyId) : undefined,
      ownerId ? parseInt(ownerId) : undefined,
    );
    return NextResponse.json(transfers);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch transfers');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const journalId = await transferEquity(body);
    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to transfer equity', { exposeMessage: true });
  }
}
