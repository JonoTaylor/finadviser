import { NextRequest, NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';

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
    const message = error instanceof Error ? error.message : 'Failed to fetch categories';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const category = await categoryRepo.create(body);
    return NextResponse.json(category, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create category' }, { status: 500 });
  }
}
