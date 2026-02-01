import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const valuation = await propertyRepo.addValuation(
      parseInt(id),
      body.valuation,
      body.valuationDate,
      body.source ?? 'manual',
    );
    return NextResponse.json(valuation, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add valuation' }, { status: 500 });
  }
}
