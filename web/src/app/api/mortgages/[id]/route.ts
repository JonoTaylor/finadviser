import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });
    const mortgage = await propertyRepo.getMortgage(mortgageId);
    if (!mortgage) return NextResponse.json({ error: 'Mortgage not found' }, { status: 404 });
    return NextResponse.json(mortgage);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load mortgage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const mortgageId = parseInt(id, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });

    // `request.json()` returns null for a body of literal `null`; coerce
    // to `{}` before destructuring so we don't TypeError below.
    const body = (await request.json().catch(() => ({}))) || {};
    const patch: { interestOnly?: boolean } = {};
    if (body.interestOnly !== undefined) {
      if (typeof body.interestOnly !== 'boolean') {
        return NextResponse.json({ error: 'interestOnly must be a boolean' }, { status: 400 });
      }
      patch.interestOnly = body.interestOnly;
    }
    const updated = await propertyRepo.updateMortgage(mortgageId, patch);
    if (!updated) return NextResponse.json({ error: 'Mortgage not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update mortgage';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
