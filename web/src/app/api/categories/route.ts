import { NextRequest, NextResponse } from 'next/server';
import { categoryRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await categoryRepo.listAll();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
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
