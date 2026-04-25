import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  constantTimeEqual,
  createSessionCookie,
  readAuthConfig,
} from '@/lib/auth/session';

export async function POST(request: NextRequest) {
  try {
    const cfg = readAuthConfig();
    if (!cfg.password || !cfg.secret) {
      return NextResponse.json(
        { error: 'Auth not configured on the server.' },
        { status: 503 },
      );
    }

    const body = await request.json().catch(() => ({} as { password?: string }));
    const submitted = typeof body.password === 'string' ? body.password : '';
    if (!submitted || !constantTimeEqual(submitted, cfg.password)) {
      // Brief delay to slow brute-forcing without making it feel broken.
      await new Promise(r => setTimeout(r, 250));
      return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
    }

    const cookieValue = await createSessionCookie(cfg.secret);
    const res = NextResponse.json({ ok: true });
    res.cookies.set({
      name: SESSION_COOKIE_NAME,
      value: cookieValue,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return res;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Login failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
