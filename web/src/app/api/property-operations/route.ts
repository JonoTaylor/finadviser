import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { writeWorkspace } from '@/lib/finance-workspace/store';
import { workspaceErrorResponse } from '@/lib/finance-workspace/api';
import { propertyRepo } from '@/lib/repos/property.repo';
import { loadPropertyOperationsWorkspace } from '@/lib/property-operations/load';
import { PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, validatePropertyReferences, UnknownPropertyError } from '@/lib/property-operations/types';

export const dynamic = 'force-dynamic';
const bodySchema = z.object({ data: propertyOperationsSchema, revision: z.number().int().min(0).max(999_999_999) }).strict();

export async function GET() {
  try {
    return NextResponse.json(await loadPropertyOperationsWorkspace(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return workspaceErrorResponse(error);
  }
}

export async function PUT(request: NextRequest) {
  let json: unknown;
  try { json = await request.json(); } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ') }, { status: 400 });
  try {
    const properties = await propertyRepo.listProperties();
    validatePropertyReferences(parsed.data.data, properties.map(row => row.id));
    return NextResponse.json(await writeWorkspace(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, parsed.data.data, parsed.data.revision), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof UnknownPropertyError) return NextResponse.json({ error: error.message }, { status: 400 });
    return workspaceErrorResponse(error);
  }
}
