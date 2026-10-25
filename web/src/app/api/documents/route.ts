import { NextResponse } from 'next/server';
import { documentRepo } from '@/lib/repos';
import { routeErrorResponse } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const docs = await documentRepo.list();
    return NextResponse.json(docs);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to list documents', { exposeMessage: true });
  }
}
