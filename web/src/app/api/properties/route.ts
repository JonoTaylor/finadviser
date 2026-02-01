import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await propertyRepo.listProperties();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch properties' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const property = await propertyRepo.createProperty(body);
    return NextResponse.json(property, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create property' }, { status: 500 });
  }
}
