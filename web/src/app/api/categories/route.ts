import { NextRequest, NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

export async function GET(request: NextRequest) {
  try {
    const parent = request.nextUrl.searchParams.get('parent');
    if (parent) {
      const data = await categoryRepo.listChildrenOfNamed(parent);
      return NextResponse.json(data);
    }
    const data = await categoryRepo.listAll();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch categories', { exposeMessage: true });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const category = await categoryRepo.create(body);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create category');
  }
}
