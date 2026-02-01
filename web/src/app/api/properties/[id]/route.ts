import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const property = await propertyRepo.getProperty(parseInt(id));
    if (!property) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [ownership, valuations, mortgages, allocations] = await Promise.all([
      propertyRepo.getOwnership(parseInt(id)),
      propertyRepo.getValuations(parseInt(id)),
      propertyRepo.getMortgages(parseInt(id)),
      propertyRepo.getAllocationRules(parseInt(id)),
    ]);

    return NextResponse.json({
      ...property,
      ownership,
      valuations,
      mortgages,
      allocations,
    });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch property' }, { status: 500 });
  }
}
