import { NextRequest, NextResponse } from 'next/server';
import { ownerTaxRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';
import { formatZodIssues, ownerTaxProfileBodySchema } from '@/lib/tax/apiSchemas';

/**
 * The saved tax-year figures the ledger can't supply (PAYE income, other
 * income, losses and finance costs brought forward) for one owner. GET
 * returns a zeroed profile with `saved: false` when nothing is stored yet.
 * PUT replaces the whole profile for that year; omitted money fields
 * become 0.00.
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

    const year = request.nextUrl.searchParams.get('year') ?? currentTaxYear().label;
    const profile = await ownerTaxRepo.getProfile(ownerId, year);
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to load tax profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownerId = parseInt(id, 10);
    if (Number.isNaN(ownerId)) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 });
    }

    const year = request.nextUrl.searchParams.get('year') ?? currentTaxYear().label;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = ownerTaxProfileBodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    }
    const input = parsed.data;

    const profile = await ownerTaxRepo.upsertProfile(ownerId, year, {
      employmentIncome: input.employmentIncome ?? '0.00',
      payeTaxPaid: input.payeTaxPaid ?? '0.00',
      selfEmploymentIncome: input.selfEmploymentIncome ?? '0.00',
      savingsInterest: input.savingsInterest ?? '0.00',
      dividends: input.dividends ?? '0.00',
      otherIncome: input.otherIncome ?? '0.00',
      propertyLossesBroughtForward: input.propertyLossesBroughtForward ?? '0.00',
      financeCostsBroughtForward: input.financeCostsBroughtForward ?? '0.00',
      notes: input.notes,
    });
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to save tax profile';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
