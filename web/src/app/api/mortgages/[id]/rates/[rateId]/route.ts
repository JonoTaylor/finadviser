import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const RATE_RE = /^\d+(\.\d+)?$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; rateId: string }> },
) {
  try {
    const { rateId } = await params;
    const id = parseInt(rateId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid rate id' }, { status: 400 });

    const body = await request.json().catch(() => ({} as { rate?: unknown; effectiveDate?: unknown }));
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
    const updated = await propertyRepo.updateMortgageRate(id, patch);
    if (!updated) return NextResponse.json({ error: 'Rate not found' }, { status: 404 });
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
    const { rateId } = await params;
    const id = parseInt(rateId, 10);
    if (Number.isNaN(id)) return NextResponse.json({ error: 'Invalid rate id' }, { status: 400 });
    await propertyRepo.deleteMortgageRate(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete rate';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
