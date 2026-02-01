import { NextRequest, NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const messages = await conversationRepo.getMessages(parseInt(id));
    return NextResponse.json(messages);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}
