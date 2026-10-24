import { NextRequest } from 'next/server';
import { z } from 'zod';
import { runAgent } from '@/lib/ai/claude-client';
import { getHistory, addUserMessage, addAssistantMessage, getOrCreateConversation } from '@/lib/ai/conversation-manager';
import { adviserMessageMetadataSchema, specialistResultSchema, type SpecialistResult } from '@/lib/ai/specialists/contracts';
import { specialistIds } from '@/lib/ai/specialists/catalog';
import { NotFoundError, ClientError } from '@/lib/errors';

export const maxDuration = 120;
const messageSchema = z.string().max(20_000).refine(value => value.trim().length > 0, 'Supply a message.');
const bodySchema = z.object({
  message: messageSchema.optional(),
  quickPrompt: messageSchema.optional(),
  conversationId: z.number().int().positive().max(2147483647).nullable().optional(),
  specialist: z.enum(['team', ...specialistIds]).default('team'),
  streamVersion: z.union([z.literal(1), z.literal(2)]).default(1),
}).strict().refine(body => Boolean(body.message || body.quickPrompt), 'Supply a message.');
const errorResponse = (error: string, status: number) => new Response(JSON.stringify({ error }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' },
});

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse('Supply a message of up to 20,000 characters and a registered specialist.', 400);
  if (request.signal.aborted) return errorResponse('This request was cancelled before it started.', 499);
  const { specialist, streamVersion } = parsed.data;
  const userMessage = parsed.data.quickPrompt ?? parsed.data.message!;
  try {
    const conversationId = await getOrCreateConversation(parsed.data.conversationId, userMessage.trim().slice(0, 50));
    // Reading prior history first avoids dropping a concurrent user's message.
    const history = await getHistory(conversationId);
    if (request.signal.aborted) return errorResponse('This request was cancelled before it started.', 499);
    await addUserMessage(conversationId, userMessage);

    const encoder = new TextEncoder();
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    let cancelled = false;
    let finished = false;
    let fullResponse = '';
    let textNeedsSeparator = false;
    const results = new Map<string, SpecialistResult>();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendJson = (value: unknown) => {
          if (cancelled || finished) return;
          controller.enqueue(encoder.encode(JSON.stringify(value) + '\n'));
        };
        const sendLegacyMetadata = (value: unknown) => {
          if (cancelled || finished) return;
          if (textNeedsSeparator) {
            controller.enqueue(encoder.encode('\n'));
            textNeedsSeparator = false;
          }
          sendJson(value);
        };
        let persisted = false;
        let persistenceAttempted = false;
        const persist = async (status: 'complete' | 'interrupted') => {
          if (persisted || persistenceAttempted) return;
          if (!fullResponse && results.size === 0 && status === 'interrupted') return;
          const content = fullResponse.trim() ? fullResponse : 'The review was interrupted before the adviser finished. Review any available specialist notes and check saved records before retrying.';
          const metadata = adviserMessageMetadataSchema.parse({
            version: 1, specialistMode: specialist, specialistResults: [...results.values()], status,
          });
          persistenceAttempted = true;
          await addAssistantMessage(conversationId, content, metadata);
          persisted = true;
          return metadata;
        };
        try {
          if (streamVersion === 2) sendJson({ type: 'conversation', conversationId });
          else sendLegacyMetadata({ conversationId });
          for await (const event of runAgent(userMessage, history, { specialist, signal })) {
            if (signal.aborted) break;
            if (event.type === 'specialist-start') {
              if (streamVersion === 2) sendJson(event);
            } else if (event.type === 'specialist-result') {
              const result = specialistResultSchema.parse(event.result);
              results.set(result.specialistId, result);
              if (streamVersion === 2) sendJson({ type: 'specialist-result', result });
            } else if (event.type === 'tool') {
              if (streamVersion === 2) sendJson(event);
              else sendLegacyMetadata({ tool: event.name, label: event.label });
            } else if (event.type === 'text') {
              fullResponse += event.content;
              if (fullResponse.length > 100_000) throw new Error('Adviser reply exceeded the response limit.');
              if (streamVersion === 2) sendJson(event);
              else if (!cancelled) {
                controller.enqueue(encoder.encode(event.content));
                textNeedsSeparator = event.content.length > 0 && !event.content.endsWith('\n');
              }
            }
          }
          if (signal.aborted) {
            await persist('interrupted');
            if (!cancelled && streamVersion === 2) sendJson({ type: 'error', message: 'The review was stopped. Completed record changes may already be saved; check them before retrying.' });
          } else {
            if (!fullResponse.trim()) throw new Error('The adviser returned no answer.');
            const metadata = await persist('complete');
            if (streamVersion === 2) sendJson({ type: 'complete', metadata });
          }
        } catch {
          // Never expose private provider/database detail to the chat client.
          try { await persist('interrupted'); } catch { /* Do not claim the history save succeeded. */ }
          const message = 'The adviser could not finish this review. Keep your question and check any completed record changes before retrying.';
          if (!cancelled) {
            if (streamVersion === 2) sendJson({ type: 'error', message });
            else controller.enqueue(encoder.encode('\n\n' + message));
          }
        } finally {
          abort.abort();
          finished = true;
          if (!cancelled) controller.close();
        }
      },
      cancel() {
        cancelled = true;
        abort.abort();
      },
    });
    return new Response(stream, {
      headers: {
        'Content-Type': streamVersion === 2 ? 'application/x-ndjson; charset=utf-8' : 'text/plain; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof ClientError) return errorResponse(error.message, error.status);
    return errorResponse('The conversation could not be prepared. Your request has not been confirmed; retry when it is available.', 503);
  }
}
