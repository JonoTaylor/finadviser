import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d+)?$/;

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });
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
    if (typeof body.rate !== 'string' || !RATE_RE.test(body.rate)) {
      return NextResponse.json({ error: 'rate must be a numeric string (percent, e.g. "5.25")' }, { status: 400 });
    }
    if (typeof body.effectiveDate !== 'string' || !ISO_DATE.test(body.effectiveDate)) {
      return NextResponse.json({ error: 'effectiveDate must be YYYY-MM-DD' }, { status: 400 });
    }
    const created = await propertyRepo.addMortgageRate(mortgageId, body.rate, body.effectiveDate);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to add rate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
