import { NextRequest, NextResponse } from 'next/server';
import { ownerReportRepo } from '@/lib/repos';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { ClientError, NotFoundError } from '@/lib/errors';

/**
 * Quarterly bridging CSV — one row per quarter with the owner's share of
 * gross rent, the period dates, and the HMRC submission deadline. Designed
 * to be ingested directly by bridging products (MyTaxDigital, FreeAgent
 * Landlord, etc.) or pasted into HMRC's quarterly update form.
 *
 * Format is intentionally flat and human-readable; bridging products vary
 * but they all accept simple CSVs with these columns. If a specific product
 * needs a different shape, transform this CSV with a one-liner rather than
 * us baking in any one product's quirks.
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

    const report = await ownerReportRepo.getQuarterlyReport({ ownerId, year });

    const header = ['Quarter', 'Period start', 'Period end', 'Submission deadline', 'Gross income (owner share)'];
    const rows = report.quarters.map(q => [
      `Q${q.index}`,
      q.startDate,
      q.endDate,
      q.submissionDeadline,
      q.grossIncome,
    ]);
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\n');

    const filename = `mtd-quarterly-${slug(report.owner.name)}-${report.taxYear.label}.csv`;
    return new Response(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ClientError || error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : 'Failed to build export';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function slug(s: string): string {
  return s.replace(/[^a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'owner';
}
