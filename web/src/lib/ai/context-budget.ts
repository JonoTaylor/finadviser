import type { ModelMessage } from 'ai';

const HISTORY_CHARS = 36_000;
const HISTORY_MESSAGE_CHARS = 6_000;
const TOOL_RESULT_CHARS = 12_000;
const TOOL_RESULTS_CHARS = 80_000;
const TRUNCATED_HISTORY = '\n\n[Earlier context shortened. Omitted details are unknown; check current records rather than assuming them.]\n\n';

type HistoryMessage = { role: 'user' | 'assistant'; content: string };

function shortenHistory(content: string, limit: number): string {
  if (content.length <= limit) return content;
  // Retain the ending as well as the beginning: an interrupted answer's final
  // warning must survive context trimming on the next request.
  const available = Math.max(0, limit - TRUNCATED_HISTORY.length);
  const tail = Math.min(1200, Math.floor(available / 3));
  return content.slice(0, available - tail) + TRUNCATED_HISTORY + (tail ? content.slice(-tail) : '');
}

/** Keep recent context bounded without altering the conversation saved in the database. */
export function boundAdviserHistory(history: readonly HistoryMessage[]): HistoryMessage[] {
  let remaining = HISTORY_CHARS;
  const bounded: HistoryMessage[] = [];
  for (const message of history.slice(-20).reverse()) {
    if (remaining < 500) break;
    const content = shortenHistory(message.content, Math.min(HISTORY_MESSAGE_CHARS, remaining));
    bounded.push({ role: message.role, content });
    remaining -= content.length;
  }
  return bounded.reverse();
}

/**
 * Preserve SDK tool-call/result pairing. Large financial reads become explicitly
 * incomplete previews, never a sliced JSON object presented as complete data.
 */
export function boundAdviserModelMessages(messages: ModelMessage[]): ModelMessage[] {
  let remaining = TOOL_RESULTS_CHARS;
  const bounded = [...messages];
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];
    if (message.role !== 'tool') continue;
    const content = [...message.content];
    for (let partIndex = content.length - 1; partIndex >= 0; partIndex--) {
      const part = content[partIndex];
      if (part.type !== 'tool-result') continue;
      const encoded = JSON.stringify(part.output);
      if (encoded.length <= TOOL_RESULT_CHARS && encoded.length <= remaining) {
        remaining -= encoded.length;
        continue;
      }
      const previewChars = Math.max(0, Math.min(TOOL_RESULT_CHARS - 800, remaining - 800));
      const output = { type: 'json' as const, value: {
        status: 'partial', truncated: true,
        warning: 'This tool result exceeded the adviser context budget. The preview is incomplete, cannot establish complete totals or successful record changes, and must not justify repeating a write. Use a narrower read to verify missing details.',
        preview: previewChars ? encoded.slice(0, previewChars) : null,
      } };
      content[partIndex] = { ...part, output };
      remaining = Math.max(0, remaining - JSON.stringify(output).length);
    }
    bounded[messageIndex] = { ...message, content };
  }
  return bounded;
}
