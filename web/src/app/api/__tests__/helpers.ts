import { NextRequest } from 'next/server';

export function jsonRequest(
  url: string,
  body: unknown,
  method: 'POST' | 'PATCH' | 'DELETE' = 'POST',
): NextRequest {
  return new NextRequest(url, {
    method,
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

export function getRequest(url: string): NextRequest {
  return new NextRequest(url, { method: 'GET' });
}

export function paramsCtx(params: Record<string, string>) {
  return { params: Promise.resolve(params) };
}
