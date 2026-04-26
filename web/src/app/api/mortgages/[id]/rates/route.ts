import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import {
  isValidCalendarDate,
  isValidRate,
  RATE_VALIDATION_MESSAGE,
  DATE_VALIDATION_MESSAGE,
} from '@/lib/properties/mortgage-rate-validation';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });

    // 404 when the parent mortgage doesn't exist — the previous
    // behaviour (silent empty array) made GET inconsistent with POST
    // and could mask client bugs.
    const mortgage = await propertyRepo.getMortgage(mortgageId);
    if (!mortgage) return NextResponse.json({ error: 'Mortgage not found' }, { status: 404 });

    const rates = await propertyRepo.getMortgageRates(mortgageId);
    return NextResponse.json(rates);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list rates';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });

    const mortgage = await propertyRepo.getMortgage(mortgageId);
    if (!mortgage) return NextResponse.json({ error: 'Mortgage not found' }, { status: 404 });

    // `request.json()` returns null for a body of literal `null`; coerce
    // to `{}` before destructuring so we don't TypeError below.
    const body = (await request.json().catch(() => ({}))) || {};
    if (!isValidRate(body.rate)) {
      return NextResponse.json({ error: RATE_VALIDATION_MESSAGE }, { status: 400 });
    }
    if (!isValidCalendarDate(body.effectiveDate)) {
      return NextResponse.json({ error: DATE_VALIDATION_MESSAGE }, { status: 400 });
    }
    const created = await propertyRepo.addMortgageRate(mortgageId, body.rate, body.effectiveDate);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add rate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
