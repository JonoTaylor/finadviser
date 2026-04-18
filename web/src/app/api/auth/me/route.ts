import { NextRequest } from 'next/server';
import { apiHandler } from '@/lib/api/handler';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth';

export const GET = apiHandler(async (req: NextRequest) => {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return { authenticated: false };
  const session = await verifySessionToken(token);
  if (!session) return { authenticated: false };
  return { authenticated: true, subject: session.sub, expiresAt: session.exp };
});
