import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { formatZodIssues, propertyPatchBodySchema } from '@/lib/tax/apiSchemas';

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

/**
 * Update editable property fields. Today that is only `lettingType`
 * ('standard' | 'rent_a_room'), which decides whether the property's
 * income pools into the UK property business or may qualify for
 * Rent-a-Room relief in the owner tax computation.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = propertyPatchBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }

    const updated = await propertyRepo.updateProperty(propertyId, parsed.data);
    if (!updated) return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update property';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
