import { NextRequest } from 'next/server';
import { streamChat } from '@/lib/ai/claude-client';
import { prepareContext } from '@/lib/ai/data-preparer';
import { getHistory, addUserMessage, addAssistantMessage, getOrCreateConversation } from '@/lib/ai/conversation-manager';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { message, conversationId: inputConvId, quickPrompt } = body;

    const userMessage = quickPrompt ?? message;
    if (!userMessage) {
      return new Response(JSON.stringify({ error: 'Message required' }), { status: 400 });
    }

    const conversationId = await getOrCreateConversation(inputConvId, userMessage.substring(0, 50));
    await addUserMessage(conversationId, userMessage);

    const [context, history] = await Promise.all([
      prepareContext(userMessage),
      getHistory(conversationId),
    ]);

    // Remove the last message (the one we just added) from history to avoid duplication
    const historyWithoutLast = history.slice(0, -1);

    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation ID first
          controller.enqueue(encoder.encode(JSON.stringify({ conversationId }) + '\n'));

          for await (const chunk of streamChat(userMessage, context, historyWithoutLast)) {
            fullResponse += chunk;
            controller.enqueue(encoder.encode(chunk));
          }

          // Save assistant response
          await addAssistantMessage(conversationId, fullResponse);
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'AI analysis failed';
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
}
