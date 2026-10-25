import { NextRequest, NextResponse } from 'next/server';
import { tenancyRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

function parseTid(tid: string): number | NextResponse {
  const id = parseInt(tid, 10);
  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid tenancy id' }, { status: 400 });
  }
  return id;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const { tid } = await params;
    const id = parseTid(tid);
    if (id instanceof NextResponse) return id;

    const tenancy = await tenancyRepo.get(id);
    if (!tenancy) return NextResponse.json({ error: 'Tenancy not found' }, { status: 404 });
    return NextResponse.json(tenancy);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to load tenancy', { exposeMessage: true });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const { tid } = await params;
    const id = parseTid(tid);
    if (id instanceof NextResponse) return id;

    const body = await readJsonBody(request);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Send the tenancy changes as a JSON object.' }, { status: 400 });
    }
    const updated = await tenancyRepo.update(id, body);
    if (!updated) return NextResponse.json({ error: 'Tenancy not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to update tenancy', { exposeMessage: true });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const { tid } = await params;
    const id = parseTid(tid);
    if (id instanceof NextResponse) return id;

    await tenancyRepo.delete(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to delete tenancy', { exposeMessage: true });
  }
}
