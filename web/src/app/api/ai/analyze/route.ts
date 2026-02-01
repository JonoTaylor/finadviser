import { NextRequest } from 'next/server';
import { runAgent } from '@/lib/ai/claude-client';
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

    const history = await getHistory(conversationId);
    // Remove the last message (the one we just added) to avoid duplication
    const historyWithoutLast = history.slice(0, -1);

    const encoder = new TextEncoder();
    let fullResponse = '';

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation ID as metadata (first line)
          controller.enqueue(encoder.encode(JSON.stringify({ conversationId }) + '\n'));

          for await (const event of runAgent(userMessage, historyWithoutLast)) {
            if (event.type === 'tool') {
              // Send tool status as a JSON line the frontend can parse
              controller.enqueue(
                encoder.encode(JSON.stringify({ tool: event.name, label: event.label }) + '\n'),
              );
            } else if (event.type === 'text') {
              fullResponse += event.content;
              controller.enqueue(encoder.encode(event.content));
            }
          }

          await addAssistantMessage(conversationId, fullResponse);
          controller.close();
        } catch (error) {
          console.error('Agent error:', error);
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
