import { NextRequest, NextResponse } from 'next/server';
import { propertyRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await propertyRepo.listOwners();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch owners' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const owner = await propertyRepo.createOwner(body.name);
    return NextResponse.json(owner, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create owner' }, { status: 500 });
  }
}
