import { NextRequest, NextResponse } from 'next/server';
import { conversationRepo } from '@/lib/repos';
import { routeErrorResponse, readJsonBody } from '@/lib/http/route-errors';

export async function GET() {
  try {
    const data = await conversationRepo.listConversations();
    return NextResponse.json(data);
  } catch (error) {
    return routeErrorResponse(error, 'Failed to fetch conversations');
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await readJsonBody(request);
    const conversation = await conversationRepo.createConversation(body.title);
    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error, 'Failed to create conversation');
  }
}
