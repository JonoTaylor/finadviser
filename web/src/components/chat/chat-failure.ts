import { z } from 'zod';
import { adviserFailureDetailsSchema, type AdviserFailureDetails } from '@/lib/ai/adviser-failure';

export type ChatFailure = { message: string } & Partial<AdviserFailureDetails>;

export class ChatRequestFailure extends Error {
  constructor(readonly failure: ChatFailure) {
    super(failure.message);
    this.name = 'ChatRequestFailure';
  }
}

const httpFailureSchema = adviserFailureDetailsSchema.partial().extend({ error: z.string().max(2000) }).strict();

export function chatHttpFailure(body: unknown): ChatFailure {
  const parsed = httpFailureSchema.safeParse(body);
  if (!parsed.success) return { message: 'The adviser request could not be started.' };
  const { error, ...details } = parsed.data;
  return { message: error, ...details };
}

/** The server already supplies change guidance for structured failures. */
export function chatFailurePresentation(failure: ChatFailure): { message: string; guidance: string; requestId?: string } {
  let message = failure.message;
  if (!failure.code) {
    // Older deployments combined the reason with instructions that the client
    // used to append again. Remove only those known legacy instructions.
    for (const sentence of [
      'Keep your question and check any completed record changes before retrying.',
      'Your message is kept below.',
      'Check any recorded changes before retrying.',
      'Completed record changes may already be saved; check them before retrying.',
    ]) message = message.replaceAll(sentence, '').trim();
  }
  const retained = failure.generationCompleted
    ? 'Your answer remains above, and your question is available to edit below.'
    : 'Your question is in the message box so you can edit it before sending again.';
  const caution = failure.recordChanges === undefined
    ? ' If you requested record changes, check your records before sending again.' : '';
  const history = failure.historySaved === false && failure.code !== 'history_unavailable'
    ? ' Saving this response to chat history could not be confirmed. Keep any answer shown before leaving this page.' : '';
  return { message: message || 'The adviser response was interrupted.', guidance: retained + caution + history, ...(failure.requestId ? { requestId: failure.requestId } : {}) };
}
