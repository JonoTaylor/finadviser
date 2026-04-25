import { NextRequest, NextResponse } from 'next/server';
import { tenancyRepo } from '@/lib/repos';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ tid: string }> },
) {
  try {
    const { tid } = await params;
    const tenancy = await tenancyRepo.get(parseInt(tid, 10));
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
    const body = await request.json();
    const updated = await tenancyRepo.update(parseInt(tid, 10), body);
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
    await tenancyRepo.delete(parseInt(tid, 10));
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to delete tenancy';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
