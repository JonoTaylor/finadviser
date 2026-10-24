import { z } from 'zod';
import { specialistIds } from '@/lib/ai/specialists/catalog';
import {
  adviserMessageMetadataSchema,
  specialistResultSchema,
} from '@/lib/ai/specialists/contracts';
import { adviserFailureDetailsSchema } from '@/lib/ai/adviser-failure';

export const MAX_CHAT_STREAM_LINE_LENGTH = 200_000;
const DECODE_WINDOW_BYTES = 16_384;

const chatStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('conversation'), conversationId: z.number().int().positive().safe() }).strict(),
  z.object({
    type: z.literal('specialist-start'),
    specialistId: z.enum(specialistIds),
    label: z.string(),
  }).strict(),
  z.object({ type: z.literal('specialist-result'), result: specialistResultSchema }).strict(),
  z.object({ type: z.literal('tool'), name: z.string(), label: z.string() }).strict(),
  z.object({ type: z.literal('text'), content: z.string() }).strict(),
  z.object({ type: z.literal('complete'), metadata: adviserMessageMetadataSchema.optional() }).strict(),
  adviserFailureDetailsSchema.partial().extend({ type: z.literal('error'), message: z.string().max(2000) }).strict(),
]);

export type ChatStreamEvent = z.infer<typeof chatStreamEventSchema>;

export class ChatStreamDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChatStreamDecodeError';
  }
}

/** Decode the v2 NDJSON transport only; assistant text is always opaque content. */
export function createChatStreamDecoder(onEvent: (event: ChatStreamEvent) => void) {
  const utf8 = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  let complete = false;
  let finished = false;
  let failed = false;

  function fail(message: string): never {
    failed = true;
    pending = '';
    throw new ChatStreamDecodeError(message);
  }

  function ensureOpen() {
    if (failed) throw new ChatStreamDecodeError('The adviser stream decoder has failed.');
    if (finished) throw new ChatStreamDecodeError('The adviser stream decoder has finished.');
  }

  function append(segment: string) {
    if (pending.length + segment.length > MAX_CHAT_STREAM_LINE_LENGTH) {
      fail('An adviser stream event exceeded the size limit.');
    }
    pending += segment;
  }

  function emitLine() {
    const line = pending;
    pending = '';
    // NDJSON accepts CRLF, and empty lines may be ignored.
    if (!line.trim()) return;
    if (complete) fail('The adviser stream continued after completion.');

    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      fail('The adviser stream contained invalid JSON.');
    }
    const parsed = chatStreamEventSchema.safeParse(value);
    if (!parsed.success) fail('The adviser stream contained an invalid event.');

    if (parsed.data.type === 'complete') complete = true;
    // Do not catch callback failures as malformed transport or expose raw payloads in errors.
    onEvent(parsed.data);
  }

  function consume(text: string) {
    let start = 0;
    for (let end = text.indexOf('\n'); end !== -1; end = text.indexOf('\n', start)) {
      append(text.slice(start, end));
      emitLine();
      start = end + 1;
    }
    append(text.slice(start));
  }

  function decode(bytes?: Uint8Array) {
    let text: string;
    try {
      text = bytes ? utf8.decode(bytes, { stream: true }) : utf8.decode();
    } catch {
      fail('The adviser stream contained invalid UTF-8.');
    }
    consume(text);
  }

  return {
    push(bytes: Uint8Array): void {
      ensureOpen();
      // A large incoming chunk must not create an unbounded decoded string before validation.
      for (let offset = 0; offset < bytes.length; offset += DECODE_WINDOW_BYTES) {
        decode(bytes.subarray(offset, offset + DECODE_WINDOW_BYTES));
      }
    },
    finish(): void {
      if (finished) return;
      ensureOpen();
      decode();
      if (pending.length) emitLine();
      finished = true;
    },
    getState() {
      return { complete, finished, failed };
    },
  };
}
