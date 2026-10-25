import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { parseId, routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';
import { ClientError, NotFoundError } from '@/lib/errors';
import { nonNegativeMoney } from '@/lib/tax/moneyInput';
import { isValidCalendarDate } from '@/lib/properties/mortgage-rate-validation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseId(id, 'property id');
    const body = await readJsonBody(request);
    // Valuations feed equity and net worth, so refuse malformed figures.
    const amount = nonNegativeMoney(body?.valuation, 'Valuation');
    if (!amount.gt(0)) throw new ClientError('Valuation must be more than zero.');
    if (!isValidCalendarDate(body?.valuationDate)) throw new ClientError('Enter the valuation date as YYYY-MM-DD.');
    if (!(await propertyRepo.getProperty(propertyId))) throw new NotFoundError('Property not found');
    const valuation = await propertyRepo.addValuation(
      propertyId,
      amount.toFixed(2),
      body.valuationDate,
      typeof body.source === 'string' && body.source.trim() ? body.source.trim() : 'manual',
    );
    return NextResponse.json(valuation, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to add valuation');
  }
}
