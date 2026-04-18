import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const VALID_SECRET = 'x'.repeat(48);

function postReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import('./route');
}

async function setupHash(password: string) {
  const { hashPassword } = await import('@/lib/auth');
  return hashPassword(password);
}

describe('POST /api/auth/signin', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://u:p@h/db';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.AUTH_SECRET = VALID_SECRET;
    delete process.env.APP_PASSWORD_HASH;
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('rejects an incorrect password', async () => {
    process.env.APP_PASSWORD_HASH = await setupHash('correct');
    const { POST } = await loadRoute();
    const res = await POST(postReq({ password: 'wrong' }), {});
    expect(res.status).toBe(400);
    expect(res.cookies.get('finadviser_session')).toBeUndefined();
  });

  it('rejects a missing password', async () => {
    const { POST } = await loadRoute();
    const res = await POST(postReq({}), {});
    expect(res.status).toBe(400);
  });

  it('sets a session cookie on a correct password', async () => {
    process.env.APP_PASSWORD_HASH = await setupHash('correct-horse-battery-staple');
    const { POST } = await loadRoute();
    const res = await POST(postReq({ password: 'correct-horse-battery-staple' }), {});
    expect(res.status).toBe(200);
    const cookie = res.cookies.get('finadviser_session');
    expect(cookie?.value).toMatch(/\S/);
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('lax');
    expect(cookie?.path).toBe('/');
  });
});
