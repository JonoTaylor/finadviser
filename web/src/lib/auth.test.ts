import { describe, it, expect, beforeEach, vi } from 'vitest';

const VALID_SECRET = 'x'.repeat(48);

async function loadAuth() {
  vi.resetModules();
  return await import('./auth');
}

function setEnv(overrides: Record<string, string | undefined>) {
  for (const k of ['DATABASE_URL', 'ANTHROPIC_API_KEY', 'AUTH_SECRET', 'APP_PASSWORD_HASH', 'SESSION_TTL_SECONDS']) {
    delete process.env[k];
  }
  process.env.DATABASE_URL = 'postgres://u:p@h/db';
  process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

describe('verifyPassword', () => {
  beforeEach(() => setEnv({}));

  it('returns false when APP_PASSWORD_HASH is not configured', async () => {
    const { verifyPassword } = await loadAuth();
    expect(await verifyPassword('anything')).toBe(false);
  });

  it('validates a correct password and rejects a wrong one', async () => {
    const { hashPassword } = await loadAuth();
    const hash = await hashPassword('correct-horse');
    setEnv({ APP_PASSWORD_HASH: hash });
    const { verifyPassword } = await loadAuth();
    expect(await verifyPassword('correct-horse')).toBe(true);
    expect(await verifyPassword('wrong-horse')).toBe(false);
  });
});

describe('session JWT', () => {
  beforeEach(() => setEnv({ AUTH_SECRET: VALID_SECRET }));

  it('round-trips a valid token', async () => {
    const { issueSessionToken, verifySessionToken } = await loadAuth();
    const token = await issueSessionToken();
    const session = await verifySessionToken(token);
    expect(session?.sub).toBe('owner');
    expect(session?.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('rejects a token signed with a different secret', async () => {
    const { issueSessionToken } = await loadAuth();
    const token = await issueSessionToken();
    setEnv({ AUTH_SECRET: 'y'.repeat(48) });
    const { verifySessionToken } = await loadAuth();
    expect(await verifySessionToken(token)).toBeNull();
  });

  it('rejects a garbage token', async () => {
    const { verifySessionToken } = await loadAuth();
    expect(await verifySessionToken('not.a.jwt')).toBeNull();
  });

  it('verifySessionTokenWith returns false for empty inputs', async () => {
    const { verifySessionTokenWith } = await loadAuth();
    expect(await verifySessionTokenWith('', VALID_SECRET)).toBe(false);
    expect(await verifySessionTokenWith('x', '')).toBe(false);
  });

  it('verifySessionTokenWith accepts a valid token with a matching secret', async () => {
    const { issueSessionToken, verifySessionTokenWith } = await loadAuth();
    const token = await issueSessionToken();
    expect(await verifySessionTokenWith(token, VALID_SECRET)).toBe(true);
    expect(await verifySessionTokenWith(token, 'z'.repeat(48))).toBe(false);
  });
});
