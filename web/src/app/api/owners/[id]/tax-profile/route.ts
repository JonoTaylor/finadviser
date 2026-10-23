import { NextRequest, NextResponse } from 'next/server';
import { ownerTaxRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';
import { formatZodIssues } from '@/lib/tax/apiSchemas';
import { ownerTaxProfilePatchSchema, TaxProfileConflictError } from '@/lib/tax/profileFacts';

/**
 * The saved tax-year figures the ledger can't supply (PAYE income, other
 * income, losses and finance costs brought forward) for one owner. GET
 * returns a zeroed profile with `saved: false` when nothing is stored yet.
 * PATCH saves only supplied values with an expected revision. Null means
 * unknown, while an explicit zero is saved as known zero. PUT is retained
 * as an alias with the same revision requirement; stale old clients must reload.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownerId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(ownerId) || ownerId < 1) {
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

/** PUT shares PATCH semantics and requires the revision the client actually read. */
export const PUT = PATCH;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ownerId = Number(id);
    if (!/^\d+$/.test(id) || !Number.isSafeInteger(ownerId) || ownerId < 1) {
      return NextResponse.json({ error: 'Invalid owner id' }, { status: 400 });
    }
    const year = request.nextUrl.searchParams.get('year');
    if (!year) return NextResponse.json({ error: 'Specify the tax year before saving a tax profile' }, { status: 400 });
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
    const parsed = ownerTaxProfilePatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: formatZodIssues(parsed.error) }, { status: 400 });
    // Browser input cannot label its own provenance as an AI write.
    const profile = await ownerTaxRepo.patchProfile(ownerId, year, { ...parsed.data, source: 'user' });
    return NextResponse.json(profile);
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError || error instanceof TaxProfileConflictError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: 'Failed to save tax profile' }, { status: 500 });
  }
}
