import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  isAuthEnabled,
  readAuthConfig,
  verifySessionCookie,
} from '@/lib/auth/session';

/**
 * Auth gate. Runs on every request that isn't a static asset (the matcher
 * below excludes those). If APP_PASSWORD + SESSION_SECRET aren't both set
 * in non-production, auth is bypassed for local dev. In production, missing
 * env vars block everything (fail-closed).
 *
 * Public paths bypassed even when auth is enabled:
 *   /login, /api/auth/login, /api/auth/logout — the auth surface itself
 *   /favicon.ico, /globals.css and other non-page assets       — handled by matcher
 *
 * Browsers hitting an unauthenticated page get a redirect to /login?next=…
 * so they bounce back to where they were going after sign-in. API callers
 * get a 401 JSON response so SWR shows a real error rather than a 200 with
 * HTML.
 */
const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
]);

export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  const cfg = readAuthConfig();
  if (!isAuthEnabled(cfg)) {
    // Local dev with no creds set — let everything through.
    return NextResponse.next();
  }
  if (!cfg.password || !cfg.secret) {
    // Production missing env vars: deny everything until they're configured.
    return new NextResponse(
      JSON.stringify({ error: 'Auth not configured: set APP_PASSWORD and SESSION_SECRET in Vercel env.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const cookie = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  const valid = await verifySessionCookie(cfg.secret, cookie);
  if (valid) return NextResponse.next();

  // API requests: respond 401 JSON so callers can handle it programmatically.
  if (pathname.startsWith('/api/')) {
    return new NextResponse(
      JSON.stringify({ error: 'Unauthenticated' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // Page requests: redirect to login with a `next` param so we land back
  // here after sign-in.
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = '/login';
  loginUrl.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Match every path except Next's internals and common static assets so
  // the middleware doesn't run for /_next/* CSS, images, favicons, etc.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|globals.css).*)'],
};
