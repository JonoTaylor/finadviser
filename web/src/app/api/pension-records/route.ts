import { NextRequest, NextResponse } from 'next/server';
import { writeWorkspace } from '@/lib/finance-workspace/store';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';
import { loadPensionRecordReferences, loadPensionRecordsWorkspace } from '@/lib/pension-records/load';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema, pensionRecordsPutSchema, validatePensionRecordLinks } from '@/lib/pension-records/schema';
import { summarizePensionRecords } from '@/lib/pension-records/summary';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    return NextResponse.json(await loadPensionRecordsWorkspace(), { headers });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  const parsed = pensionRecordsPutSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({
    error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; '),
  }, { status: 400 });
  try {
    const references = await loadPensionRecordReferences();
    const errors = validatePensionRecordLinks(parsed.data.data, references.owners, references.pensionAccounts);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 400 });
    const workspace = await writeWorkspace(PENSION_RECORDS_KEY, pensionRecordsDataSchema, parsed.data.data, parsed.data.revision);
    return NextResponse.json({ workspace, ...references, summary: summarizePensionRecords(workspace.data, references.pensionAccounts) }, { headers });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
