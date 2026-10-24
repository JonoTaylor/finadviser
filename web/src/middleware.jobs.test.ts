import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('APP_PASSWORD', 'synthetic-password');
  vi.stubEnv('SESSION_SECRET', 'synthetic-worker-only-secret-123456');
});
afterEach(() => vi.unstubAllEnvs());

describe('worker route session boundary', () => {
  it('exempts only the exact HMAC-verified worker route while protecting user job/control endpoints', async () => {
    const worker = await middleware(new NextRequest('https://fixture.vercel.app/api/categorization/jobs/worker', { method: 'POST' }));
    expect(worker.headers.get('x-middleware-next')).toBe('1');
    for (const path of ['/api/categorization/jobs', '/api/categorization/jobs/some-id', '/api/categorization/jobs/worker/extra']) {
      expect((await middleware(new NextRequest('https://fixture.vercel.app' + path))).status).toBe(401);
    }
  });
  it('keeps production fail-closed even for worker handoffs when application auth is not configured', async () => {
    vi.stubEnv('SESSION_SECRET', '');
    expect((await middleware(new NextRequest('https://fixture.vercel.app/api/categorization/jobs/worker', { method: 'POST' }))).status).toBe(503);
  });
});
