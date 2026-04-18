import { z } from 'zod';
import { NextResponse } from 'next/server';
import { apiHandler, badRequest, validateBody } from '@/lib/api/handler';
import { issueSessionToken, sessionTtlSeconds, verifyPassword, SESSION_COOKIE } from '@/lib/auth';
import { log } from '@/lib/logger';

const bodySchema = z.object({
  password: z.string().min(1).max(500),
});

export const POST = apiHandler(async (req) => {
  const { password } = await validateBody(req, bodySchema);
  const ok = await verifyPassword(password);
  if (!ok) {
    log.warn('auth.signin_rejected', { route: req.nextUrl.pathname });
    throw badRequest('Invalid credentials');
  }

  const token = await issueSessionToken();
  const ttl = sessionTtlSeconds();
  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: ttl,
  });
  log.info('auth.signin_succeeded', {});
  return res;
});
