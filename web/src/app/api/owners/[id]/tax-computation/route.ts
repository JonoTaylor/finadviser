import { NextRequest, NextResponse } from 'next/server';
import { ownerTaxRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';

/**
 * Full income-tax computation for one owner and tax year: the property
 * profit (at the owner's share), S.24 finance-cost relief, tax by band,
 * the Self Assessment balance, payments on account, tax attributable to
 * rental income and MTD ITSA status, with a step-by-step breakdown.
 * An estimate, not tax advice.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownerId = parseInt(id, 10);
    if (Number.isNaN(ownerId)) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 });
    }

    const yearParam = request.nextUrl.searchParams.get('year');
    const year = yearParam ?? currentTaxYear().label;

    const computation = await ownerTaxRepo.getTaxComputation({ ownerId, year });
    return NextResponse.json(computation);
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to compute tax';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
