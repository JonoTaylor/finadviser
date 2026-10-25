import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const data = await propertyRepo.listOwners();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch owners');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const owner = await propertyRepo.createOwner(body.name);
    return NextResponse.json(owner, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create owner');
  }
}
