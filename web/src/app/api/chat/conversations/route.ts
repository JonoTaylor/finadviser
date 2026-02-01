import { NextRequest, NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';

export async function GET() {
  try {
    const data = await conversationRepo.listConversations();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const conversation = await conversationRepo.createConversation(body.title);
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 });
  }
}
