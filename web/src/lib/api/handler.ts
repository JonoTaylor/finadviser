import { NextRequest, NextResponse } from 'next/server';
import { z, ZodError } from 'zod';
import { log, newRequestId } from '@/lib/logger';

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

const REQUEST_ID_HEADER = 'x-request-id';

function tagResponse(res: NextResponse, requestId: string): NextResponse {
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

export function apiHandler(handler: Handler) {
  return async (request: NextRequest, context: unknown): Promise<NextResponse> => {
    const requestId = request.headers.get(REQUEST_ID_HEADER) ?? newRequestId();
    const route = request.nextUrl.pathname;
    const method = request.method;
    try {
      const result = await handler(request, context);
      if (result instanceof Response) {
        (result as NextResponse).headers.set(REQUEST_ID_HEADER, requestId);
        return result as NextResponse;
      }
      if (result === undefined) {
        return tagResponse(new NextResponse(null, { status: 204 }), requestId);
      }
      return tagResponse(NextResponse.json(result), requestId);
    } catch (err) {
      if (err instanceof ApiError) {
        log.info('api.client_error', {
          requestId,
          route,
          method,
          status: err.status,
          message: err.message,
        });
        return tagResponse(
          NextResponse.json({ error: err.message, ...err.extra }, { status: err.status }),
          requestId,
        );
      }
      if (err instanceof ZodError) {
        log.info('api.validation_error', {
          requestId,
          route,
          method,
          issues: err.issues.length,
        });
        return tagResponse(
          NextResponse.json(
            { error: 'Validation failed', issues: err.issues },
            { status: 400 },
          ),
          requestId,
        );
      }
      log.error('api.unhandled_error', {
        requestId,
        route,
        method,
        err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : String(err),
      });
      return tagResponse(
        NextResponse.json(
          { error: 'Internal server error', correlationId: requestId },
          { status: 500 },
        ),
        requestId,
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
