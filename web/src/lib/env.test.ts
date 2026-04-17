import { describe, it, expect, beforeEach, vi } from 'vitest';

async function loadEnv() {
  vi.resetModules();
  return await import('./env');
}

const VALID_ENV = {
  DATABASE_URL: 'postgres://u:p@h/db',
  ANTHROPIC_API_KEY: 'sk-ant-test',
};

describe('env()', () => {
  beforeEach(() => {
    for (const k of [
      'DATABASE_URL',
      'ANTHROPIC_API_KEY',
      'CLAUDE_MODEL',
      'API_AUTH_TOKEN',
      'ADMIN_TOKEN',
      'ALLOW_SEED',
      'NODE_ENV',
    ]) {
      delete process.env[k];
    }
  });

  it('parses a valid environment', async () => {
    Object.assign(process.env, VALID_ENV);
    const { env } = await loadEnv();
    const cfg = env();
    expect(cfg.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(cfg.ANTHROPIC_API_KEY).toBe(VALID_ENV.ANTHROPIC_API_KEY);
    expect(cfg.CLAUDE_MODEL).toBe('claude-sonnet-4-20250514');
    expect(cfg.ALLOW_SEED).toBe(false);
  });

  it('throws a structured error when required vars are missing', async () => {
    const { env } = await loadEnv();
    expect(() => env()).toThrowError(/DATABASE_URL/);
  });

  it('coerces ALLOW_SEED="true" to boolean true', async () => {
    Object.assign(process.env, VALID_ENV, { ALLOW_SEED: 'true' });
    const { env } = await loadEnv();
    expect(env().ALLOW_SEED).toBe(true);
  });

  it('rejects short admin tokens', async () => {
    Object.assign(process.env, VALID_ENV, { ADMIN_TOKEN: 'short' });
    const { env } = await loadEnv();
    expect(() => env()).toThrowError(/ADMIN_TOKEN/);
  });

  it('memoizes the parsed config across calls', async () => {
    Object.assign(process.env, VALID_ENV);
    const { env } = await loadEnv();
    const a = env();
    const b = env();
    expect(a).toBe(b);
  });
});
