import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { backfillPropertyExpensesForProperty } from '@/lib/properties/property-expense-link';

/**
 * One-shot backfill: link every existing journal that sits under the
 * "Property expenses" category subtree but has NULL property_id, to
 * this property. Used to fix historical data after a categorisation
 * pass that didn't stamp property_id. Subsequent calls are no-ops
 * for already-linked rows.
 */
export async function POST(
  _request: NextRequest,
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
    const linked = await backfillPropertyExpensesForProperty(propertyId);
    return NextResponse.json({ propertyId, linked });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to auto-link expenses';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
