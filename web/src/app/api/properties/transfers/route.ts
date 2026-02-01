import { NextRequest, NextResponse } from 'next/server';
import { transferEquity } from '@/lib/properties/transfer-engine';
import { propertyRepo } from '@/lib/repos';

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
    return NextResponse.json({ error: 'Failed to fetch transfers' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const journalId = await transferEquity(body);
    return NextResponse.json({ journalId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to transfer equity';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
