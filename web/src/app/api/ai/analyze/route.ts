import { NextRequest } from 'next/server';
import { runAgent } from '@/lib/ai/claude-client';
import { getHistory, addUserMessage, addAssistantMessage, getOrCreateConversation } from '@/lib/ai/conversation-manager';

// Allow up to 120s for agentic tool-use loops
export const maxDuration = 120;

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
    // Track whether the last chunk sent was text without a trailing newline,
    // so we can inject a separator before JSON metadata lines.
    let textNeedsSeparator = false;

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // Send conversation ID as metadata (first line)
          controller.enqueue(encoder.encode(JSON.stringify({ conversationId }) + '\n'));

          for await (const event of runAgent(userMessage, historyWithoutLast)) {
            if (event.type === 'tool') {
              // Ensure JSON metadata starts on its own line
              if (textNeedsSeparator) {
                controller.enqueue(encoder.encode('\n'));
                textNeedsSeparator = false;
              }
              controller.enqueue(
                encoder.encode(JSON.stringify({ tool: event.name, label: event.label }) + '\n'),
              );
            } else if (event.type === 'text') {
              fullResponse += event.content;
              controller.enqueue(encoder.encode(event.content));
              textNeedsSeparator = event.content.length > 0 && !event.content.endsWith('\n');
            }
          }

          await addAssistantMessage(conversationId, fullResponse);
          controller.close();
        } catch (error) {
          console.error('Agent error:', error);
          // Send a readable error message before closing so the client
          // doesn't just show a generic failure.
          try {
            const errMsg = '\n\nSorry, something went wrong processing your request. Please try again.';
            fullResponse += errMsg;
            controller.enqueue(encoder.encode(errMsg));
            await addAssistantMessage(conversationId, fullResponse);
            controller.close();
          } catch {
            controller.error(error);
          }
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
