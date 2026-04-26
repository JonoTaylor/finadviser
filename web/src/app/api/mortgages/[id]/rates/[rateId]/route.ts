import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d+)?$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rateId: string }> },
) {
  try {
    const { id: mortgageIdParam, rateId: rateIdParam } = await params;
    const mortgageId = parseInt(mortgageIdParam, 10);
    const rateIdNum = parseInt(rateIdParam, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });
    if (Number.isNaN(rateIdNum)) return NextResponse.json({ error: 'Invalid rate id' }, { status: 400 });

    // `request.json()` returns null for a body of literal `null`; coerce
    // to `{}` before destructuring so we don't TypeError on `.rate`.
    const body = (await request.json().catch(() => ({}))) || {};
    const patch: { rate?: string; effectiveDate?: string } = {};
    if (body.rate !== undefined) {
      if (typeof body.rate !== 'string' || !RATE_RE.test(body.rate)) {
        return NextResponse.json({ error: 'rate must be a numeric string' }, { status: 400 });
      }
      patch.rate = body.rate;
    }
    if (body.effectiveDate !== undefined) {
      if (typeof body.effectiveDate !== 'string' || !ISO_DATE.test(body.effectiveDate)) {
        return NextResponse.json({ error: 'effectiveDate must be YYYY-MM-DD' }, { status: 400 });
      }
      patch.effectiveDate = body.effectiveDate;
    }
    // Guarded update: the WHERE in updateMortgageRate also filters by
    // mortgageId so a rateId belonging to a different mortgage returns
    // null (404) instead of silently mutating someone else's row.
    const updated = await propertyRepo.updateMortgageRate(rateIdNum, mortgageId, patch);
    if (!updated) {
      return NextResponse.json({ error: 'Rate not found for this mortgage' }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update rate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; rateId: string }> },
) {
  try {
    const { id: mortgageIdParam, rateId: rateIdParam } = await params;
    const mortgageId = parseInt(mortgageIdParam, 10);
    const rateIdNum = parseInt(rateIdParam, 10);
    if (Number.isNaN(mortgageId)) return NextResponse.json({ error: 'Invalid mortgage id' }, { status: 400 });
    if (Number.isNaN(rateIdNum)) return NextResponse.json({ error: 'Invalid rate id' }, { status: 400 });
    const deleted = await propertyRepo.deleteMortgageRate(rateIdNum, mortgageId);
    if (!deleted) {
      return NextResponse.json({ error: 'Rate not found for this mortgage' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
