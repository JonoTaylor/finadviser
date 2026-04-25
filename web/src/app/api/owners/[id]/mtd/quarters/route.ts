import { NextRequest, NextResponse } from 'next/server';
import { ownerReportRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';

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

    const report = await ownerReportRepo.getQuarterlyReport({ ownerId, year });
    return NextResponse.json(report);
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build quarterly report';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
