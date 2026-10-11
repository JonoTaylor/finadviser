import { NextRequest, NextResponse } from 'next/server';
import { debtPutSchema } from '@/lib/debts/types';
import { loadDebtWorkspace, saveDebtWorkspace } from '@/lib/debts/load';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(await loadDebtWorkspace(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }); }
  try {
    const parsed = debtPutSchema.parse(body);
    return NextResponse.json(await saveDebtWorkspace(parsed.data, parsed.revision), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}
