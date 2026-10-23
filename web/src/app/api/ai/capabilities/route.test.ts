import { afterEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

describe('adviser capabilities endpoint', () => {
  afterEach(() => { vi.unstubAllEnvs(); });
  it('exposes the current tax-profile writer without caching an old registry or exposing personal data', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    vi.stubEnv('VERCEL_GIT_COMMIT_SHA', 'b'.repeat(40));
    vi.stubEnv('VERCEL_PROJECT_PRODUCTION_URL', 'finance.example.com');
    vi.stubEnv('DATABASE_URL', 'secret-db-connection');
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toContain('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ version: 1, capabilities: { taxProfile: { read: true, save: true } },
      release: { commit: 'b'.repeat(40), productionUrl: 'https://finance.example.com' } });
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body).not.toHaveProperty('profile');
  });
});
