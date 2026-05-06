import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { currentTaxYear, taxYearRange } from '@/lib/tax/ukTaxYear';
import { calculateBtlProfitability } from '@/lib/properties/btl-profitability';
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
    const range = yearParam ? taxYearRange(yearParam) : currentTaxYear();

    const result = await calculateBtlProfitability({
      propertyId,
      startDate: range.startDate,
      endDate: range.endDate,
      incomeTaxRatePct: searchParams.get('incomeTaxRatePct'),
      mortgageInterestReliefRatePct: searchParams.get('mortgageInterestReliefRatePct'),
    });

    return NextResponse.json({
      property: { id: property.id, name: property.name, address: property.address },
      taxYear: range,
      ...result,
    });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build profitability view';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
