import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  ApiError,
  apiHandler,
  badRequest,
  notFound,
  validateBody,
  validateQuery,
  validateParams,
} from './handler';

function makeRequest(
  url = 'http://localhost/api/test',
  init?: { method?: string; body?: string; headers?: Record<string, string> },
): NextRequest {
  return new NextRequest(url, init);
}

describe('apiHandler', () => {
  it('JSON-ifies a plain return value', async () => {
    const handler = apiHandler(async () => ({ hello: 'world' }));
    const res = await handler(makeRequest(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: 'world' });
  });

  it('returns 204 on undefined', async () => {
    const handler = apiHandler(async () => undefined);
    const res = await handler(makeRequest(), {});
    expect(res.status).toBe(204);
  });

  it('passes through a Response', async () => {
    const handler = apiHandler(async () => new Response('csv', { status: 200 }));
    const res = await handler(makeRequest(), {});
    expect(await res.text()).toBe('csv');
  });

  it('translates ZodError to 400 with issues', async () => {
    const schema = z.object({ x: z.number() });
    const handler = apiHandler(async () => {
      schema.parse({ x: 'nope' });
      return {};
    });
    const res = await handler(makeRequest(), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('Validation failed');
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('translates ApiError to its status with extras', async () => {
    const handler = apiHandler(async () => {
      throw new ApiError(418, "I'm a teapot", { hint: 'brew tea' });
    });
    const res = await handler(makeRequest(), {});
    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "I'm a teapot", hint: 'brew tea' });
  });

  it('translates unknown errors to 500 with a correlation id', async () => {
    const handler = apiHandler(async () => {
      throw new Error('boom');
    });
    const res = await handler(makeRequest(), {});
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe('Internal server error');
    expect(typeof body.correlationId).toBe('string');
  });
});

describe('helpers', () => {
  it('badRequest and notFound build ApiErrors', () => {
    const bad = badRequest('nope');
    expect(bad).toBeInstanceOf(ApiError);
    expect(bad.status).toBe(400);
    const nf = notFound('Widget');
    expect(nf.status).toBe(404);
    expect(nf.message).toMatch(/Widget/);
  });

  it('validateBody parses JSON body and throws badRequest on bad JSON', async () => {
    const schema = z.object({ name: z.string() });
    const good = makeRequest('http://localhost/', {
      method: 'POST',
      body: JSON.stringify({ name: 'ok' }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect(await validateBody(good, schema)).toEqual({ name: 'ok' });

    const bad = makeRequest('http://localhost/', {
      method: 'POST',
      body: 'not-json',
      headers: { 'Content-Type': 'application/json' },
    });
    await expect(validateBody(bad, schema)).rejects.toBeInstanceOf(ApiError);
  });

  it('validateQuery parses search params', () => {
    const req = makeRequest('http://localhost/api/x?limit=5&q=tesco');
    const schema = z.object({
      limit: z.string().regex(/^\d+$/).transform((v) => parseInt(v, 10)),
      q: z.string(),
    });
    expect(validateQuery(req, schema)).toEqual({ limit: 5, q: 'tesco' });
  });

  it('validateParams awaits and parses context params', async () => {
    const ctx = { params: Promise.resolve({ id: '42' }) };
    const schema = z.object({
      id: z.string().regex(/^\d+$/).transform((v) => parseInt(v, 10)),
    });
    expect(await validateParams(ctx, schema)).toEqual({ id: 42 });
  });
});
