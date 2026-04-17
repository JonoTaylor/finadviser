import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';

// Central error + response wrapper for /api/* route handlers.
//
// - handlers may throw `ApiError` to signal a controlled failure with a
//   specific status and optional extra payload fields (e.g. validation
//   issues). Everything else becomes a 500 with a correlation id and a
//   server-side log line containing the stack.
// - ZodError thrown from `validateBody` / `validateQuery` is translated to
//   a 400 with the issue list.
// - handlers may return plain objects (JSON-ified) or a NextResponse.

export class ApiError extends Error {
  readonly status: number;
  readonly extra: Record<string, unknown>;
  constructor(status: number, message: string, extra: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const notFound = (what = 'Resource') => new ApiError(404, `${what} not found`);
export const badRequest = (msg: string, extra?: Record<string, unknown>) =>
  new ApiError(400, msg, extra);

type Handler = (request: NextRequest, context: unknown) => Promise<unknown>;

export function apiHandler(handler: Handler) {
  return async (request: NextRequest, context: unknown): Promise<NextResponse> => {
    try {
      const result = await handler(request, context);
      if (result instanceof Response) return result as NextResponse;
      if (result === undefined) return new NextResponse(null, { status: 204 });
      return NextResponse.json(result);
    } catch (err) {
      if (err instanceof ApiError) {
        return NextResponse.json({ error: err.message, ...err.extra }, { status: err.status });
      }
      if (err instanceof ZodError) {
        return NextResponse.json(
          { error: 'Validation failed', issues: err.issues },
          { status: 400 },
        );
      }
      const correlationId =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : String(Date.now());
      console.error(`[api] unhandled error correlationId=${correlationId}`, err);
      return NextResponse.json(
        { error: 'Internal server error', correlationId },
        { status: 500 },
      );
    }
  };
}

export async function validateBody<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw badRequest('Request body must be valid JSON');
  }
  return schema.parse(json);
}

export function validateQuery<T extends z.ZodTypeAny>(
  request: NextRequest,
  schema: T,
): z.infer<T> {
  const entries: Record<string, string> = {};
  request.nextUrl.searchParams.forEach((value, key) => {
    entries[key] = value;
  });
  return schema.parse(entries);
}

export async function validateParams<
  T extends z.ZodTypeAny,
  C extends { params: Promise<Record<string, string>> },
>(context: C, schema: T): Promise<z.infer<T>> {
  const params = await context.params;
  return schema.parse(params);
}
