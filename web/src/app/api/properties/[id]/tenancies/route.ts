import { NextRequest, NextResponse } from 'next/server';
import { tenancyRepo, propertyRepo } from '@/lib/repos';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });

    const tenancies = await tenancyRepo.listByProperty(propertyId);
    return NextResponse.json(tenancies);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to list tenancies';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const propertyId = parseInt(id, 10);
    if (Number.isNaN(propertyId)) return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });

    const property = await propertyRepo.getProperty(propertyId);
    if (!property) return NextResponse.json({ error: 'Property not found' }, { status: 404 });

    const body = await request.json();
    if (!body.tenantName || !body.startDate || !body.rentAmount) {
      return NextResponse.json(
        { error: 'tenantName, startDate, and rentAmount are required' },
        { status: 400 },
      );
    }

    const created = await tenancyRepo.create({
      propertyId,
      tenantName: body.tenantName,
      startDate: body.startDate,
      endDate: body.endDate ?? null,
      rentAmount: body.rentAmount,
      rentFrequency: body.rentFrequency ?? 'monthly',
      depositAmount: body.depositAmount ?? null,
      notes: body.notes ?? null,
    });
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create tenancy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
