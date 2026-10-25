import { NextResponse } from 'next/server';
import { importBatchRepo } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const data = await importBatchRepo.listAll();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch batches');
  }
}
