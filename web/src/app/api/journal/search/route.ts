import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const limit = parseInt(request.nextUrl.searchParams.get('limit') ?? '50');
    const data = await journalRepo.search(q, limit);
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to search');
  }
}
