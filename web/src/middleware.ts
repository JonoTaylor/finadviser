import { NextRequest, NextResponse } from 'next/server';

// Skeleton API authentication middleware.
//
// In production, every /api/* request must carry
//   Authorization: Bearer <API_AUTH_TOKEN>
// matching the env var of the same name. In development the middleware is a
// no-op unless API_AUTH_TOKEN is set, to keep local workflows smooth.
//
// This is intentionally a shared-secret stub; the follow-up in the review
// plan is to replace it with proper session/JWT auth (NextAuth, Clerk, etc.)
// so the browser UI can authenticate as a real user.

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function middleware(request: NextRequest) {
  const token = process.env.API_AUTH_TOKEN;
  const isProd = process.env.NODE_ENV === 'production';

  if (!token) {
    if (isProd) {
      return NextResponse.json(
        { error: 'API_AUTH_TOKEN is not configured on the server.' },
        { status: 503 },
      );
    }
    return NextResponse.next();
  }

  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  if (!provided || !timingSafeEqual(provided, token)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/api/:path*'],
};
