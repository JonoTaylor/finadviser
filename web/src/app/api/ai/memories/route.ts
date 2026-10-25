import { NextRequest, NextResponse } from 'next/server';
import { aiMemoryRepo, AI_MEMORY_MAX_CONTENT_LENGTH } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const memories = await aiMemoryRepo.list();
    return NextResponse.json(memories);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to list memories', { exposeMessage: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) || {};
    if (typeof body.content !== 'string') {
      return NextResponse.json({ error: 'content must be a string' }, { status: 400 });
    }
    // Validate AFTER trimming so the check matches what the repo
    // actually persists. The repo also throws on these conditions but
    // we map to 400 here so the caller doesn't see a 500.
    const trimmed = body.content.trim();
    if (trimmed.length === 0) {
      return NextResponse.json({ error: 'content must be a non-empty string' }, { status: 400 });
    }
    if (trimmed.length > AI_MEMORY_MAX_CONTENT_LENGTH) {
      return NextResponse.json(
        { error: `content too long (max ${AI_MEMORY_MAX_CONTENT_LENGTH} chars)` },
        { status: 400 },
      );
    }
    const memory = await aiMemoryRepo.add(trimmed, 'user');
    return NextResponse.json(memory, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to add memory', { exposeMessage: true });
  }
}
