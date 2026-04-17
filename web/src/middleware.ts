import { NextRequest, NextResponse } from 'next/server';

// Edge middleware for /api/* requests:
//   1. Rate limit (in-memory fixed-window, per request IP)
//   2. CORS (allowlist via ALLOWED_ORIGINS env var)
//   3. Bearer-token auth against API_AUTH_TOKEN
//
// The rate limiter is per-process, so behind a multi-region deploy (Vercel
// edge) each region has its own counter. For strict global limits, swap in
// Upstash or similar — tracked in the improvement plan.
//
// The auth layer is a shared-secret stub; the follow-up is proper session
// auth so the browser UI can authenticate as a real user.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

const WINDOW_MS = 60_000;
const DEFAULT_LIMIT = 120;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

function rateLimit(key: string, limit: number): { ok: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    const fresh: Bucket = { count: 1, resetAt: now + WINDOW_MS };
    buckets.set(key, fresh);
    return { ok: true, remaining: limit - 1, resetAt: fresh.resetAt };
  }
  b.count += 1;
  const ok = b.count <= limit;
  return { ok, remaining: Math.max(0, limit - b.count), resetAt: b.resetAt };
}

function clientKey(request: NextRequest): string {
  const fwd = request.headers.get('x-forwarded-for');
  const ip = fwd?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${ip}:${request.nextUrl.pathname}`;
}

function parseAllowedOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS ?? '';
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function applyCorsHeaders(headers: Headers, origin: string | null, allowed: string[]) {
  if (!origin) return;
  if (allowed.includes('*') || allowed.includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin);
    headers.set('Vary', 'Origin');
    headers.set('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
    headers.set('Access-Control-Max-Age', '600');
  }
}

export function middleware(request: NextRequest) {
  const origin = request.headers.get('origin');
  const allowedOrigins = parseAllowedOrigins();

  // CORS preflight — answer before auth/rate-limit so browsers can proceed.
  if (request.method === 'OPTIONS') {
    const res = new NextResponse(null, { status: 204 });
    applyCorsHeaders(res.headers, origin, allowedOrigins);
    return res;
  }

  // Rate limit.
  const limit = Math.max(1, parseInt(process.env.RATE_LIMIT_PER_MIN ?? '', 10) || DEFAULT_LIMIT);
  const rl = rateLimit(clientKey(request), limit);
  if (!rl.ok) {
    const retryAfter = Math.max(1, Math.ceil((rl.resetAt - Date.now()) / 1000));
    const res = NextResponse.json(
      { error: 'Too many requests' },
      { status: 429, headers: { 'Retry-After': String(retryAfter) } },
    );
    applyCorsHeaders(res.headers, origin, allowedOrigins);
    return res;
  }

  // Auth.
  const token = process.env.API_AUTH_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';

  let response: NextResponse;
  if (!token) {
    if (isProd) {
      response = NextResponse.json(
        { error: 'API_AUTH_TOKEN is not configured on the server.' },
        { status: 503 },
      );
    } else {
      response = NextResponse.next();
    }
  } else {
    const header = request.headers.get('authorization') ?? '';
    const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    if (!provided || !timingSafeEqual(provided, token)) {
      response = NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    } else {
      response = NextResponse.next();
    }
  }

  response.headers.set('X-RateLimit-Limit', String(limit));
  response.headers.set('X-RateLimit-Remaining', String(rl.remaining));
  response.headers.set('X-RateLimit-Reset', String(Math.ceil(rl.resetAt / 1000)));
  applyCorsHeaders(response.headers, origin, allowedOrigins);
  return response;
}

export const config = {
  matcher: ['/api/:path*'],
};
