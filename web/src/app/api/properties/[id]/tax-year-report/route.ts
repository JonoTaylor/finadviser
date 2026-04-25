import { NextRequest, NextResponse } from 'next/server';
import { rentalReportRepo, propertyRepo } from '@/lib/repos';
import { taxYearRange, currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError } from '@/lib/errors';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    const property = await propertyRepo.getProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const yearParam = searchParams.get('year');
    const ownerParam = searchParams.get('ownerId');

    const range = yearParam ? taxYearRange(yearParam) : currentTaxYear();
    const ownerId = ownerParam ? parseInt(ownerParam, 10) : null;
    if (ownerParam && Number.isNaN(ownerId as number)) {
      return NextResponse.json({ error: 'Invalid ownerId' }, { status: 400 });
    }

    const report = await rentalReportRepo.getTaxYearReport({
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
      ownerId,
    });

    return NextResponse.json({
      property: { id: property.id, name: property.name, address: property.address },
      taxYear: range,
      ...report,
    });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
