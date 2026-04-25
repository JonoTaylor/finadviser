/**
 * NDJSON streaming helpers for the import pipeline. Routes return one
 * JSON object per line, each terminated by '\n'; the client reads via
 * `fetch` + body-reader and parses lines as they arrive.
 *
 * Why NDJSON, not Server-Sent Events: SSE is designed for EventSource
 * which only supports GET. The import endpoints take POST bodies (form
 * data / JSON), so we use fetch with a streaming response and parse the
 * body manually. Same outcome — real-time progress — without EventSource
 * limitations.
 */

export type ProgressEvent =
  | { phase: 'parsing' }
  | { phase: 'parsed'; total: number }
  | { phase: 'checking-duplicates'; total: number }
  | { phase: 'categorising'; total: number }
  | { phase: 'saving'; processed: number; total: number }
  | { phase: 'done'; result: unknown }
  | { phase: 'error'; message: string };

/**
 * Wrap an async generator function in a Response whose body emits one
 * ProgressEvent per line as NDJSON. Errors thrown inside `run` are
 * captured as a final 'error' event so the client always gets one
 * terminal event.
 */
export function ndjsonStream(
  run: (emit: (event: ProgressEvent) => void) => Promise<void>,
): Response {
  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder();
      const emit = (event: ProgressEvent) => {
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
        } catch {
          // Client disconnected; ignore further enqueues.
        }
      };
      try {
        await run(emit);
      } catch (e) {
        emit({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
      } finally {
        try { controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      // Disable Vercel's proxy buffering so events ship as we emit, not
      // when the response closes.
      'X-Accel-Buffering': 'no',
    },
  });
}
