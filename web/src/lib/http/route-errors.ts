import { NextResponse } from 'next/server';
import { ClientError, NotFoundError } from '@/lib/errors';

/**
 * Turns a failure inside a route handler into a JSON error response.
 *
 * Caller mistakes (ClientError, NotFoundError) keep their status and
 * message. Anything else is logged so it appears in the deployment logs,
 * then reported as a 500 with `fallback`. `exposeMessage` keeps the
 * behaviour of routes that show the underlying error text to the user.
 */
export function routeErrorResponse(
  error: unknown,
  fallback: string,
  options: { exposeMessage?: boolean } = {},
): NextResponse {
  if (error instanceof ClientError || error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error(`[api] ${fallback}`, describeError(error));
  const message = options.exposeMessage ? userFacingMessage(error) ?? fallback : fallback;
  return NextResponse.json({ error: message }, { status: 500 });
}

/** Like `request.json()`, but a malformed body is the caller's mistake (400). */
export async function readJsonBody(request: Request): ReturnType<Request['json']> {
  try {
    return await request.json();
  } catch {
    throw new ClientError('The request body must be valid JSON.');
  }
}

/** Parses a positive integer route or query id, rejecting anything else. */
export function parseId(value: string | null | undefined, label: string): number {
  const id = value != null && /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isSafeInteger(id) || id < 1) throw new ClientError(`Invalid ${label}`);
  return id;
}

/**
 * Drizzle reports query failures as "Failed query: <sql>\nparams: <values>"
 * with the database error as `cause`. The values can be financial records,
 * so neither the logs nor the user see them; the database's own message is
 * more useful anyway.
 */
function underlyingError(error: unknown): unknown {
  if (error instanceof Error && error.message.startsWith('Failed query:') && error.cause) return error.cause;
  return error;
}

function userFacingMessage(error: unknown): string | null {
  const inner = underlyingError(error);
  return inner instanceof Error && inner.message ? firstLine(inner.message) : null;
}

function describeError(error: unknown): Record<string, unknown> {
  const inner = underlyingError(error);
  if (!(inner instanceof Error)) return { value: String(inner) };
  const code = (inner as { code?: unknown }).code;
  return {
    name: inner.name,
    message: firstLine(inner.message),
    ...(typeof code === 'string' ? { code } : {}),
    ...(inner !== error && error instanceof Error ? { wrappedBy: error.name } : {}),
    // Frames only: the stack's first line repeats the message.
    stack: (error instanceof Error ? error.stack ?? '' : '')
      .split('\n').filter(line => line.trimStart().startsWith('at ')).slice(0, 8).map(line => line.trim()),
  };
}

function firstLine(message: string): string {
  return message.split('\n', 1)[0].slice(0, 500);
}
