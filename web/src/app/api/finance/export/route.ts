import { NextResponse } from 'next/server';
import { FinanceExportUnavailableError, loadFinancePlanningExport } from '@/lib/finance-reviews/export';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const data = await loadFinancePlanningExport();
    return new Response(JSON.stringify(data, null, 2), { headers: {
      ...HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="finadviser-planning-${data.asOf}.json"`,
    } });
  } catch (error) {
    return NextResponse.json({
      status: 'unavailable',
      code: error instanceof FinanceExportUnavailableError ? error.code : 'EXPORT_UNAVAILABLE',
      section: error instanceof FinanceExportUnavailableError ? error.section : undefined,
      error: error instanceof FinanceExportUnavailableError ? error.message : 'Your planning export is unavailable. Check the database connection and retry.',
    }, { status: 503, headers: HEADERS });
  }
}
