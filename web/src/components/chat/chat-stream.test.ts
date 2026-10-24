import { describe, expect, it, vi } from 'vitest';
import type { SpecialistResult } from '@/lib/ai/specialists/contracts';
import {
  ChatStreamDecodeError,
  createChatStreamDecoder,
  MAX_CHAT_STREAM_LINE_LENGTH,
  type ChatStreamEvent,
} from './chat-stream';

const encoder = new TextEncoder();
const result: SpecialistResult = {
  specialistId: 'tax',
  name: 'Tax specialist',
  status: 'complete',
  report: {
    summary: 'Review the recorded position.',
    findings: [{ title: 'Recorded income', detail: 'Income is available.', priority: 'low', evidenceIds: ['e1'] }],
    gaps: [], actions: [], assumptions: [], warnings: [],
  },
  sources: [{ id: 'e1', tool: 'read_tax', observedAt: '2026-10-24T12:00:00.000Z', status: 'available', parameters: { year: 2026 }, truncated: false }],
  durationMs: 200,
  modelId: 'test-model',
  promptVersion: '1',
  scope: 'read_only',
  message: null,
};

function encode(events: ChatStreamEvent[], trailingNewline = true) {
  return encoder.encode(events.map(event => JSON.stringify(event)).join('\n') + (trailingNewline ? '\n' : ''));
}

function collector() {
  const events: ChatStreamEvent[] = [];
  return { events, decoder: createChatStreamDecoder(event => events.push(event)) };
}

describe('incremental adviser NDJSON decoder', () => {
  const events: ChatStreamEvent[] = [
    { type: 'conversation', conversationId: 12 },
    { type: 'specialist-start', specialistId: 'tax', label: 'Tax specialist' },
    { type: 'specialist-result', result },
    { type: 'tool', name: 'read_tax', label: 'Reviewing tax information' },
    { type: 'text', content: 'Income £10,000. Café ☕.\nSecond line.' },
    { type: 'complete', metadata: { version: 1, specialistMode: 'team', specialistResults: [result], status: 'complete' } },
  ];

  it('decodes all event types at every possible two-chunk byte boundary', () => {
    const bytes = encode(events);
    for (let offset = 0; offset <= bytes.length; offset++) {
      const { decoder, events: received } = collector();
      decoder.push(bytes.subarray(0, offset));
      decoder.push(bytes.subarray(offset));
      decoder.finish();
      expect(received).toEqual(events);
      expect(decoder.getState()).toEqual({ complete: true, finished: true, failed: false });
    }
  });

  it('handles single-byte chunks, split multibyte UTF-8, CRLF, and blank lines', () => {
    const expected: ChatStreamEvent = { type: 'text', content: '£ → café 🏡\nEscaped \\n and "quotes"' };
    const bytes = encoder.encode(`\r\n  \n${JSON.stringify(expected)}\r\n\n`);
    const { decoder, events: received } = collector();
    for (const byte of bytes) decoder.push(Uint8Array.of(byte));
    decoder.finish();
    expect(received).toEqual([expected]);
  });

  it('emits complete events immediately and flushes a valid final line without a newline', () => {
    const { decoder, events: received } = collector();
    decoder.push(encode([{ type: 'text', content: 'hello' }]));
    expect(received).toEqual([{ type: 'text', content: 'hello' }]);
    decoder.push(encode([{ type: 'complete' }], false));
    expect(decoder.getState().complete).toBe(false);
    decoder.finish();
    expect(received).toEqual([{ type: 'text', content: 'hello' }, { type: 'complete' }]);
  });

  it('preserves JSON-looking assistant text without treating it as protocol', () => {
    const literal = '{"type":"complete","metadata":{"secret":"ignore"}}\n{"type":"tool","name":"delete"}';
    const { decoder, events: received } = collector();
    decoder.push(encode([{ type: 'text', content: literal }]));
    decoder.finish();
    expect(received).toEqual([{ type: 'text', content: literal }]);
    expect(decoder.getState().complete).toBe(false);
  });

  it('lets the caller distinguish an interrupted stream with no complete event', () => {
    const { decoder, events: received } = collector();
    decoder.push(encode([{ type: 'text', content: 'partial' }]));
    decoder.finish();
    decoder.finish();
    expect(received).toEqual([{ type: 'text', content: 'partial' }]);
    expect(decoder.getState()).toEqual({ complete: false, finished: true, failed: false });
    expect(() => decoder.push(encoder.encode('\n'))).toThrow(ChatStreamDecodeError);
  });

  it('forwards a valid server error event', () => {
    const { decoder, events: received } = collector();
    decoder.push(encode([{ type: 'error', message: 'The review was interrupted.' }]));
    decoder.finish();
    expect(received).toEqual([{ type: 'error', message: 'The review was interrupted.' }]);
  });

  it('preserves safe structured failure context without treating a completed answer as interrupted', () => {
    const error: ChatStreamEvent = {
      type: 'error', message: 'Your answer finished, but saving chat history could not be confirmed.',
      code: 'history_unavailable', requestId: '0b3f4d52-a902-465e-a209-507fc0649c1a',
      retryable: false, recordChanges: 'none', historySaved: false, generationCompleted: true,
    };
    const { decoder, events: received } = collector();
    decoder.push(encode([{ type: 'text', content: 'Your completed financial review.' }, error]));
    decoder.finish();
    expect(received).toEqual([{ type: 'text', content: 'Your completed financial review.' }, error]);
    expect(decoder.getState().failed).toBe(false);
  });

  it.each([
    '{bad JSON}\n',
    '{"type":"text","content":"unterminated',
    'null\n',
    '[]\n',
    '{"type":"future-critical-event"}\n',
    '{"type":"text","content":12}\n',
    '{"type":"text","content":"ok","unexpected":true}\n',
    '{"type":"conversation","conversationId":"12"}\n',
    '{"type":"conversation","conversationId":0}\n',
    '{"type":"conversation","conversationId":1.2}\n',
    '{"type":"conversation","conversationId":9007199254740992}\n',
    '{"type":"specialist-start","specialistId":"unknown","label":"unknown"}\n',
    '{"type":"specialist-start","specialistId":"tax","label":false}\n',
    '{"type":"specialist-result","result":{"specialistId":"tax"}}\n',
    '{"type":"tool","name":"test","label":null}\n',
    '{"type":"error","message":false}\n',
    '{"type":"complete","metadata":{"version":2}}\n',
    '{"type":"error","message":"Stopped","code":"invented_private_error"}\n',
    '{"type":"error","message":"Stopped","requestId":"private diagnostic body"}\n',
    '{"type":"error","message":"Stopped","recordChanges":"confirmed"}\n',
    '{"type":"error","message":"Stopped","retryable":"yes"}\n',
    '{"type":"error","message":"Stopped","providerResponse":"private financial data"}\n',
  ])('rejects malformed, truncated, unknown, or incorrectly typed events safely: %s', input => {
    const onEvent = vi.fn();
    const decoder = createChatStreamDecoder(onEvent);
    expect(() => { decoder.push(encoder.encode(input)); decoder.finish(); }).toThrow(ChatStreamDecodeError);
    expect(onEvent).not.toHaveBeenCalled();
    expect(decoder.getState().failed).toBe(true);
    expect(() => decoder.push(encode([{ type: 'text', content: 'later' }]))).toThrow(ChatStreamDecodeError);
    expect(() => decoder.finish()).toThrow(ChatStreamDecodeError);
  });

  it('rejects malformed nested specialist results and completion metadata', () => {
    for (const event of [
      { type: 'specialist-result', result: { ...result, scope: 'write' } },
      { type: 'specialist-result', result: { ...result, sources: [{ ...result.sources[0], parameters: { bad: { nested: true } } }] } },
      { type: 'complete', metadata: { version: 1, specialistMode: 'tax', specialistResults: [result], status: 'invented' } },
    ]) {
      const { decoder, events: received } = collector();
      expect(() => decoder.push(encoder.encode(JSON.stringify(event) + '\n'))).toThrow('invalid event');
      expect(received).toEqual([]);
    }
  });

  it('stops at a malformed line before later valid events and hides raw content in errors', () => {
    const { decoder, events: received } = collector();
    const bytes = encoder.encode('{"type":"text","content":"first"}\n{"secret":"private data"\n{"type":"text","content":"later"}\n');
    expect(() => decoder.push(bytes)).toThrow('invalid JSON');
    expect(() => decoder.finish()).not.toThrow('private data');
    expect(received).toEqual([{ type: 'text', content: 'first' }]);
  });

  it('rejects invalid UTF-8 and a truncated final multibyte character', () => {
    const decoder = createChatStreamDecoder(vi.fn());
    expect(() => decoder.push(Uint8Array.of(0xff))).toThrow('invalid UTF-8');
    const truncated = createChatStreamDecoder(vi.fn());
    truncated.push(encoder.encode('{"type":"text","content":"'));
    truncated.push(Uint8Array.of(0xf0, 0x9f));
    expect(() => truncated.finish()).toThrow('invalid UTF-8');
  });

  it('rejects an oversized line in a single large chunk or many small chunks', () => {
    const input = encoder.encode(' '.repeat(MAX_CHAT_STREAM_LINE_LENGTH + 1));
    for (const chunkSize of [input.length, 997]) {
      const decoder = createChatStreamDecoder(vi.fn());
      expect(() => {
        for (let offset = 0; offset < input.length; offset += chunkSize) decoder.push(input.subarray(offset, offset + chunkSize));
      }).toThrow('size limit');
      expect(decoder.getState().failed).toBe(true);
    }
  });

  it('allows many valid events whose total size exceeds the per-line bound', () => {
    const event: ChatStreamEvent = { type: 'text', content: 'x'.repeat(10_000) };
    const expected = Array.from({ length: 30 }, () => event);
    const { decoder, events: received } = collector();
    decoder.push(encode(expected));
    decoder.finish();
    expect(received).toEqual(expected);
  });

  it('rejects another event after completion', () => {
    const { decoder, events: received } = collector();
    expect(() => decoder.push(encode([{ type: 'complete' }, { type: 'text', content: 'late' }]))).toThrow('after completion');
    expect(received).toEqual([{ type: 'complete' }]);
  });
});
