import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runAgent } from '@/lib/ai/claude-client';
import { getHistory, addUserMessage, addAssistantMessage, getOrCreateConversation } from '@/lib/ai/conversation-manager';
import { adviserMessageMetadataSchema, specialistResultSchema, type SpecialistResult } from '@/lib/ai/specialists/contracts';
import { specialistIds } from '@/lib/ai/specialists/catalog';
import { NotFoundError, ClientError } from '@/lib/errors';
import { AdviserFailureError, adviserFailureDetailsSchema, adviserFailureMessage, classifyAdviserFailure, type AdviserFailureDetails, type ClassifiedAdviserFailure } from '@/lib/ai/adviser-failure';
import { isRecordChangingAdviserTool } from '@/lib/ai/tool-policy';

export const maxDuration = 120;
const PREPARATION_MS = 10_000;
const GENERATION_DEADLINE_MS = 105_000;
const SAVE_MS = 8_000;
const FINALIZE_DEADLINE_MS = 113_000;
const messageSchema = z.string().max(20_000).refine(value => value.trim().length > 0, 'Supply a message.');
const bodySchema = z.object({
  message: messageSchema.optional(),
  quickPrompt: messageSchema.optional(),
  conversationId: z.number().int().positive().max(2147483647).nullable().optional(),
  specialist: z.enum(['team', ...specialistIds]).default('team'),
  streamVersion: z.union([z.literal(1), z.literal(2)]).default(1),
}).strict().refine(body => Boolean(body.message || body.quickPrompt), 'Supply a message.');
const errorResponse = (error: string, status: number, requestId: string) => new Response(JSON.stringify({ error, requestId }), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store', 'X-Adviser-Request-Id': requestId },
});

function logFailure(requestId: string, stage: 'generation' | 'history' | 'preparation', failure: ClassifiedAdviserFailure, details?: Pick<AdviserFailureDetails, 'recordChanges' | 'historySaved' | 'generationCompleted'>) {
  // Structured diagnostics deliberately exclude the error object, message,
  // cause, provider body, question, conversation ID and tool arguments.
  console.error('[adviser] request failed', { requestId, stage, ...failure, ...details });
}

/** A database driver may ignore cancellation; do not let it hold the stream open. */
async function boundedPreparationOrSave<T>(operation: () => Promise<T>, deadlineAt: number, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new AdviserFailureError('request_cancelled');
  const remaining = deadlineAt - Date.now();
  if (remaining <= 0) throw new AdviserFailureError('history_unavailable');
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new AdviserFailureError('history_unavailable')), remaining);
        if (signal) {
          onAbort = () => reject(new AdviserFailureError('request_cancelled'));
          signal.addEventListener('abort', onAbort, { once: true });
          if (signal.aborted) onAbort();
        }
      }),
    ]);
  } finally {
    clearTimeout(timeout);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}

export async function POST(request: NextRequest) {
  const requestId = randomUUID();
  const startedAt = Date.now();
  const preparationDeadline = startedAt + PREPARATION_MS;
  const generationDeadline = startedAt + GENERATION_DEADLINE_MS;
  const finalizeDeadline = startedAt + FINALIZE_DEADLINE_MS;
  const prepare = <T>(operation: () => Promise<T>) => boundedPreparationOrSave(operation, preparationDeadline, request.signal);
  try {
    const parsed = bodySchema.safeParse(await prepare(() => request.json().catch(() => null)));
    if (!parsed.success) return errorResponse('Supply a message of up to 20,000 characters and a registered specialist.', 400, requestId);
    if (request.signal.aborted) return errorResponse('This request was cancelled before it started.', 499, requestId);
    const { specialist, streamVersion } = parsed.data;
    const userMessage = parsed.data.quickPrompt ?? parsed.data.message!;
    const conversationId = await prepare(() => getOrCreateConversation(parsed.data.conversationId, userMessage.trim().slice(0, 50)));
    // Reading prior history first avoids dropping a concurrent user's message.
    const history = await prepare(() => getHistory(conversationId));
    if (request.signal.aborted) return errorResponse('This request was cancelled before it started.', 499, requestId);
    await prepare(() => addUserMessage(conversationId, userMessage));

    const encoder = new TextEncoder();
    const abort = new AbortController();
    const signal = AbortSignal.any([request.signal, abort.signal]);
    let cancelled = false;
    let finished = false;
    let fullResponse = '';
    let textNeedsSeparator = false;
    let recordChangeStarted = false;
    let generationCompleted = false;
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
        let failureStage: 'generation' | 'history' = 'generation';
        const persist = async (status: 'complete' | 'interrupted') => {
          if (persisted || persistenceAttempted) return;
          const answer = fullResponse.trim() ? fullResponse : 'The adviser stopped before finishing its answer. Any available specialist notes may be incomplete.';
          // Keep this warning in content as well as metadata: older clients and
          // the bounded text-only model history must not treat partial advice
          // as a completed recommendation after a reload or another turn.
          const notice = status === 'interrupted'
            ? `\n\n**Review interrupted.** This answer is incomplete. ${recordChangeStarted ? 'Check any saved record changes before retrying an action. ' : ''}Obtain a fresh review before acting on it.`
            : '';
          const content = answer.slice(0, 100_000 - notice.length) + notice;
          const metadata = adviserMessageMetadataSchema.parse({
            version: 1, specialistMode: specialist, specialistResults: [...results.values()], status,
          });
          persistenceAttempted = true;
          // An unsettled insert may still commit after this race. Never retry
          // it or describe a timeout as proof that history was not saved.
          await boundedPreparationOrSave(
            () => addAssistantMessage(conversationId, content, metadata),
            Math.min(Date.now() + SAVE_MS, finalizeDeadline),
          );
          persisted = true;
          return metadata;
        };
        try {
          if (streamVersion === 2) sendJson({ type: 'conversation', conversationId });
          else sendLegacyMetadata({ conversationId });
          for await (const event of runAgent(userMessage, history, {
            specialist, signal, deadlineAt: generationDeadline,
            onToolStart(name) {
              if (isRecordChangingAdviserTool(name)) recordChangeStarted = true;
            },
          })) {
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
              if (fullResponse.length > 100_000) throw new AdviserFailureError('response_limit');
              if (streamVersion === 2) sendJson(event);
              else if (!cancelled) {
                controller.enqueue(encoder.encode(event.content));
                textNeedsSeparator = event.content.length > 0 && !event.content.endsWith('\n');
              }
            }
          }
          if (signal.aborted) {
            throw new AdviserFailureError('request_cancelled');
          } else {
            if (!fullResponse.trim()) throw new AdviserFailureError('no_answer');
            generationCompleted = true;
            failureStage = 'history';
            const metadata = await persist('complete');
            if (streamVersion === 2) sendJson({ type: 'complete', metadata });
          }
        } catch (error) {
          const failure = classifyAdviserFailure(error, failureStage);
          if (!persistenceAttempted) {
            try { await persist('interrupted'); }
            catch (historyError) {
              logFailure(requestId, 'history', classifyAdviserFailure(historyError, 'history'), {
                recordChanges: recordChangeStarted ? 'possible' : 'none', historySaved: false, generationCompleted,
              });
            }
          }
          const details = adviserFailureDetailsSchema.parse({
            code: failure.code, requestId, retryable: failure.retryable,
            recordChanges: recordChangeStarted ? 'possible' : 'none', historySaved: persisted, generationCompleted,
          });
          logFailure(requestId, failureStage, failure, details);
          const message = adviserFailureMessage(details);
          if (!cancelled) {
            if (streamVersion === 2) sendJson({ type: 'error', message, ...details });
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
        'X-Adviser-Request-Id': requestId,
      },
    });
  } catch (error) {
    if (request.signal.aborted) return errorResponse('This request was cancelled before it started.', 499, requestId);
    if (error instanceof NotFoundError || error instanceof ClientError) return errorResponse(error.message, error.status, requestId);
    logFailure(requestId, 'preparation', classifyAdviserFailure(error, 'preparation'));
    return errorResponse('The conversation could not be prepared. Your request has not been confirmed; retry when it is available.', 503, requestId);
  }
}
