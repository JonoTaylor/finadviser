import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';
import { parseId, routeErrorResponse } from '@/lib/http/route-errors';

function boundedInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, min), max) : fallback;
}

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const filters = {
      startDate: params.get('startDate') ?? undefined,
      endDate: params.get('endDate') ?? undefined,
      categoryId: params.get('categoryId') ? parseId(params.get('categoryId'), 'category') : undefined,
      accountId: params.get('accountId') ? parseId(params.get('accountId'), 'account') : undefined,
      query: params.get('q') ?? undefined,
      hideTransfers: params.get('hideTransfers') === 'true',
      // Bounded so a stray parameter cannot request the whole ledger at once.
      limit: boundedInt(params.get('limit'), 100, 1, 500),
      offset: boundedInt(params.get('offset'), 0, 0, Number.MAX_SAFE_INTEGER),
    };

    const [entries, total] = await Promise.all([
      journalRepo.listEntries(filters),
      journalRepo.countEntries(filters),
    ]);

    return NextResponse.json({ entries, total });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch journal entries');
  }
}
