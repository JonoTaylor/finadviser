import { NextRequest, NextResponse } from 'next/server';
import { tipRepo } from '@/lib/repos';
import { parseId, routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const tips = await tipRepo.listActive();
    return NextResponse.json(tips);
  } catch {
    // Table may not exist yet — return empty array gracefully
    return NextResponse.json([]);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });
    await tipRepo.dismiss(parseId(id, 'tip id'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to dismiss tip');
  }
}
