import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const data = await propertyRepo.listProperties();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch properties');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const property = await propertyRepo.createProperty(body);
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create property');
  }
}
