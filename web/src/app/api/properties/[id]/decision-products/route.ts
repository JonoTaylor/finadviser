import { NextRequest, NextResponse } from 'next/server';
import { btlDecisionProductRepo, propertyRepo } from '@/lib/repos';
import { ClientError } from '@/lib/errors';

/**
 * List + create endpoint for BTL decision product candidates. Scoped
 * to a property so the front-end can read/write the user's candidates
 * for that property only.
 */
export async function GET(
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
    const rows = await btlDecisionProductRepo.listByProperty(propertyId);
    return NextResponse.json({ products: rows });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to list products';
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
    if (Number.isNaN(propertyId)) {
      return NextResponse.json({ error: 'Invalid property id' }, { status: 400 });
    }
    const property = await propertyRepo.getProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    const body = await request.json();
    if (!body?.name || !body?.ratePct || !body?.monthlyPayment) {
      return NextResponse.json(
        { error: 'name, ratePct and monthlyPayment are required' },
        { status: 400 },
      );
    }
    const row = await btlDecisionProductRepo.create({
      propertyId,
      name: body.name,
      productType: body.productType ?? 'fixed',
      ratePct: String(body.ratePct),
      productFee: String(body.productFee ?? '0'),
      exitFee: String(body.exitFee ?? '0'),
      monthlyPayment: String(body.monthlyPayment),
      ercSchedule: Array.isArray(body.ercSchedule) ? body.ercSchedule : [],
    });
    return NextResponse.json({ product: row }, { status: 201 });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to create product';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
