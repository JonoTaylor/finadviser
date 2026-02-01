import { NextRequest, NextResponse } from 'next/server';
import { categorizeBatch } from '@/lib/ai/claude-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const result = await categorizeBatch(body.descriptions, body.categories);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to categorize' }, { status: 500 });
  }
}
