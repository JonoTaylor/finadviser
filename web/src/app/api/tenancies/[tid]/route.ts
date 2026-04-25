import { NextRequest, NextResponse } from 'next/server';
import { tenancyRepo } from '@/lib/repos';

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
    const message = error instanceof Error ? error.message : 'Failed to load tenancy';
    return NextResponse.json({ error: message }, { status: 500 });
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

    const body = await request.json();
    const updated = await tenancyRepo.update(id, body);
    if (!updated) return NextResponse.json({ error: 'Tenancy not found' }, { status: 404 });
    return NextResponse.json(updated);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update tenancy';
    return NextResponse.json({ error: message }, { status: 500 });
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
    const message = error instanceof Error ? error.message : 'Failed to delete tenancy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
