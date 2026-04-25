/**
 * Client-side reader for NDJSON streams emitted by /api/import/preview
 * and /api/import/confirm. Calls onEvent for each parsed line; resolves
 * with the value of the final 'done' event (or rejects on 'error' /
 * non-2xx response).
 */

import type { ProgressEvent } from './stream';

export type ProgressHandler = (event: ProgressEvent) => void;

export async function consumeNdjsonImport<TResult = unknown>(
  url: string,
  init: RequestInit,
  onEvent: ProgressHandler,
): Promise<TResult> {
  const res = await fetch(url, init);
  if (!res.ok || !res.body) {
    // Non-streaming error path (e.g. middleware 401, invalid body 400).
    let body: { error?: string } = {};
    try { body = await res.json(); } catch {}
    throw new Error(body.error || `HTTP ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: TResult | undefined;
  let errored: string | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineAt = buffer.indexOf('\n');
    while (newlineAt !== -1) {
      const line = buffer.slice(0, newlineAt).trim();
      buffer = buffer.slice(newlineAt + 1);
      newlineAt = buffer.indexOf('\n');
      if (!line) continue;
      let event: ProgressEvent;
      try {
        event = JSON.parse(line) as ProgressEvent;
      } catch {
        // Malformed line — skip, don't break the whole stream
        continue;
      }
      if (event.phase === 'done') {
        result = event.result as TResult;
      } else if (event.phase === 'error') {
        errored = event.message;
      } else {
        onEvent(event);
      }
    }
  }

  if (errored) throw new Error(errored);
  if (result === undefined) throw new Error('Stream ended without a result');
  return result;
}
