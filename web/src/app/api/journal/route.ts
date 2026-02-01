import { NextRequest, NextResponse } from 'next/server';
import { journalRepo } from '@/lib/repos';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const filters = {
      startDate: params.get('startDate') ?? undefined,
      endDate: params.get('endDate') ?? undefined,
      categoryId: params.get('categoryId') ? parseInt(params.get('categoryId')!) : undefined,
      accountId: params.get('accountId') ? parseInt(params.get('accountId')!) : undefined,
      query: params.get('q') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!) : 100,
      offset: params.get('offset') ? parseInt(params.get('offset')!) : 0,
    };

    const [entries, total] = await Promise.all([
      journalRepo.listEntries(filters),
      journalRepo.countEntries(filters),
    ]);

    return NextResponse.json({ entries, total });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch journal entries' }, { status: 500 });
  }
}
