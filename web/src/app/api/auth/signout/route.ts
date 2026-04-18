import { NextResponse } from 'next/server';
import { apiHandler } from '@/lib/api/handler';
import { SESSION_COOKIE } from '@/lib/auth';
import { log } from '@/lib/logger';

export const POST = apiHandler(async () => {
  const res = NextResponse.json({ success: true });
  res.cookies.set({
    name: SESSION_COOKIE,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });
  log.info('auth.signout', {});
  return res;
});
