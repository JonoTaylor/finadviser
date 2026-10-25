import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limitParam = url.searchParams.get('limit');
    let limit = 50;
    if (limitParam !== null) {
      const parsed = Number(limitParam);
      if (Number.isFinite(parsed)) {
        limit = Math.min(Math.max(Math.trunc(parsed), 1), 200);
      }
    }
    const candidates = await journalRepo.listTransferReviewQueue(limit);
    return NextResponse.json({ candidates });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to load review queue', { exposeMessage: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const groupId = body?.groupId;
    const action = body?.action;
    if (typeof groupId !== 'string' || !UUID_RE.test(groupId)) {
      return NextResponse.json({ error: 'groupId must be a valid UUID' }, { status: 400 });
    }
    if (action !== 'confirm' && action !== 'reject') {
      return NextResponse.json({ error: 'action must be "confirm" or "reject"' }, { status: 400 });
    }

    if (action === 'confirm') {
      const merged = await journalRepo.confirmTransferGroup(groupId);
      return NextResponse.json({ success: true, action, merged });
    }
    await journalRepo.dismissTransferGroup(groupId);
    return NextResponse.json({ success: true, action });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to update review item', { exposeMessage: true });
  }
}
