import { NextResponse } from 'next/server';
import { loadDataIntelligence } from '@/lib/data-intelligence/load';

export const dynamic = 'force-dynamic';
const HEADERS = { 'Cache-Control': 'no-store' };

/** Read-only; finding gaps never processes transactions or writes assumptions. */
export async function GET() {
  try {
    const report = await loadDataIntelligence();
    if (report.status === 'unavailable') return NextResponse.json({ ...report, code: 'DATA_INTELLIGENCE_UNAVAILABLE', error: 'Your financial data could not be read. Retry when the connection is available. Missing inputs and balances remain unknown.' }, { status: 503, headers: HEADERS });
    return NextResponse.json(report, { headers: HEADERS });
  } catch {
    return NextResponse.json({ code: 'DATA_INTELLIGENCE_UNAVAILABLE', error: 'Your financial data could not be read. Retry when the connection is available. No data or financial assumptions have been changed.' }, { status: 503, headers: HEADERS });
  }
}
