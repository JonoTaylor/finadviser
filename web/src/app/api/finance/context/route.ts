import { NextRequest, NextResponse } from 'next/server';
import { loadFinancialContext, FINANCIAL_CONTEXT_KEY } from '@/lib/finance-context';
import { loadContextLookup, validateContextReferences } from '@/lib/finance-context/lookup';
import { contextSchema, contextWriteSchema } from '@/lib/finance-context/schema';
import { writeWorkspace } from '@/lib/finance-workspace/store';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };

export async function GET() {
  try {
    const [workspace, lookup] = await Promise.all([loadFinancialContext(), loadContextLookup()]);
    return NextResponse.json({ ...workspace, lookup }, { headers });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400, headers });
  }
  try {
    const parsed = contextWriteSchema.parse(body);
    const lookup = await loadContextLookup();
    validateContextReferences(parsed.data, lookup);
    const workspace = await writeWorkspace(FINANCIAL_CONTEXT_KEY, contextSchema, parsed.data, parsed.revision);
    return NextResponse.json({ ...workspace, lookup }, { headers });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
