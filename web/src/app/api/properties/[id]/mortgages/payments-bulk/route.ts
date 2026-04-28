import { NextRequest, NextResponse } from 'next/server';
import { recordMortgagePayments } from '@/lib/properties/mortgage-tracker';
import { propertyRepo } from '@/lib/repos/property.repo';

/**
 * POST /api/properties/[id]/mortgages/payments-bulk
 *
 * Body: {
 *   mortgageId: number,
 *   payerOwnerId: number,
 *   fromAccountId: number,
 *   payments: Array<{ date: string (YYYY-MM-DD), amount: string, principal?: string }>
 * }
 *
 * Idempotent across re-runs via the reference-based dedup in
 * recordMortgagePayments. Returns counts so the UI / AI tool can
 * echo back what changed without re-querying.
 */
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

    const body = await request.json();
    const { mortgageId, payerOwnerId, fromAccountId, payments } = body ?? {};

    if (typeof mortgageId !== 'number' || typeof payerOwnerId !== 'number' || typeof fromAccountId !== 'number') {
      return NextResponse.json(
        { error: 'mortgageId, payerOwnerId, fromAccountId must all be numbers' },
        { status: 400 },
      );
    }
    if (!Array.isArray(payments) || payments.length === 0) {
      return NextResponse.json({ error: 'payments must be a non-empty array' }, { status: 400 });
    }

    // Defence in depth: confirm the mortgage actually belongs to
    // this property so a manipulated body can't cross-post.
    const mortgages = await propertyRepo.getMortgages(propertyId);
    if (!mortgages.find(m => m.id === mortgageId)) {
      return NextResponse.json(
        { error: `Mortgage ${mortgageId} does not belong to property ${propertyId}` },
        { status: 400 },
      );
    }

    const validatedPayments: Array<{ date: string; amount: string; principal?: string }> = [];
    for (const p of payments) {
      if (typeof p?.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
        return NextResponse.json(
          { error: `Each payment.date must be YYYY-MM-DD; got ${p?.date}` },
          { status: 400 },
        );
      }
      if (typeof p.amount !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(p.amount)) {
        return NextResponse.json(
          { error: `Each payment.amount must be a decimal string; got ${p.amount}` },
          { status: 400 },
        );
      }
      if (p.principal !== undefined && (typeof p.principal !== 'string' || !/^-?\d+(?:\.\d{1,2})?$/.test(p.principal))) {
        return NextResponse.json(
          { error: `payment.principal, when supplied, must be a decimal string; got ${p.principal}` },
          { status: 400 },
        );
      }
      validatedPayments.push({ date: p.date, amount: p.amount, principal: p.principal });
    }

    const result = await recordMortgagePayments({
      mortgageId,
      payerOwnerId,
      fromAccountId,
      payments: validatedPayments,
    });

    return NextResponse.json({
      added: result.added.length,
      duplicates: result.duplicates.length,
      errors: result.errors.length,
      details: result,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to record bulk payments';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
