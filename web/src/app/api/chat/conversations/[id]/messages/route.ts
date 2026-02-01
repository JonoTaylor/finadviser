import { NextRequest, NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const message = await conversationRepo.addMessage(parseInt(id), body.role, body.content);
    return NextResponse.json(message, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to add message' }, { status: 500 });
  }
}
