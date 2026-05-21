import { NextRequest, NextResponse } from 'next/server';
import { btlDecisionProductRepo, propertyRepo } from '@/lib/repos';
import { ClientError } from '@/lib/errors';

/**
 * Per-product PATCH / DELETE. IDOR-guarded by requiring BOTH the
 * property id and the product id in the path; the repo's update +
 * archive helpers match both columns before writing.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; productId: string }> },
) {
  try {
    const { id, productId } = await params;
    const propertyId = parseInt(id, 10);
    const numericProductId = parseInt(productId, 10);
    if (Number.isNaN(propertyId) || Number.isNaN(numericProductId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const property = await propertyRepo.getProperty(propertyId);
    if (!property) {
      return NextResponse.json({ error: 'Property not found' }, { status: 404 });
    }
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const row = await btlDecisionProductRepo.update(numericProductId, propertyId, {
      name: typeof body.name === 'string' ? body.name : undefined,
      productType: typeof body.productType === 'string' ? body.productType : undefined,
      ratePct: body.ratePct != null ? String(body.ratePct) : undefined,
      productFee: body.productFee != null ? String(body.productFee) : undefined,
      exitFee: body.exitFee != null ? String(body.exitFee) : undefined,
      monthlyPayment:
        body.monthlyPayment != null ? String(body.monthlyPayment) : undefined,
      ercSchedule: Array.isArray(body.ercSchedule)
        ? (body.ercSchedule as Array<{ untilMonth: number; pct: string }>)
        : undefined,
    });
    if (!row) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ product: row });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to update product';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; productId: string }> },
) {
  try {
    const { id, productId } = await params;
    const propertyId = parseInt(id, 10);
    const numericProductId = parseInt(productId, 10);
    if (Number.isNaN(propertyId) || Number.isNaN(numericProductId)) {
      return NextResponse.json({ error: 'Invalid id' }, { status: 400 });
    }
    const archived = await btlDecisionProductRepo.archive(numericProductId, propertyId);
    if (!archived) {
      return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof ClientError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to archive product';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
