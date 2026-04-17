import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// env() is read on every request; we swap process.env between cases and
// reset the env module cache to force a re-parse.
vi.mock('@/lib/repos', () => ({
  accountRepo: { create: vi.fn().mockResolvedValue({ id: 1 }) },
  journalRepo: { createEntry: vi.fn().mockResolvedValue(1) },
  propertyRepo: {
    createOwner: vi.fn().mockResolvedValue({ id: 1 }),
    createProperty: vi.fn().mockResolvedValue({ id: 1 }),
    addOwnership: vi.fn().mockResolvedValue(undefined),
    createMortgage: vi.fn().mockResolvedValue({ id: 1 }),
    addMortgageRate: vi.fn().mockResolvedValue(undefined),
    addValuation: vi.fn().mockResolvedValue(undefined),
    setAllocationRule: vi.fn().mockResolvedValue(undefined),
  },
  categoryRepo: { create: vi.fn().mockResolvedValue({ id: 1 }) },
}));

function bearerRequest(token?: string): NextRequest {
  return new NextRequest('http://localhost/api/seed', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

async function loadRoute() {
  vi.resetModules();
  return await import('./route');
}

const ADMIN = 'x'.repeat(32);

describe('POST /api/seed (gating)', () => {
  beforeEach(() => {
    for (const k of ['ALLOW_SEED', 'ADMIN_TOKEN', 'DATABASE_URL', 'ANTHROPIC_API_KEY', 'NODE_ENV']) {
      delete process.env[k];
    }
    process.env.DATABASE_URL = 'postgres://u:p@h/db';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
  });

  it('refuses when ALLOW_SEED is not true', async () => {
    process.env.ADMIN_TOKEN = ADMIN;
    const { POST } = await loadRoute();
    const res = await POST(bearerRequest(ADMIN));
    expect(res.status).toBe(403);
  });

  it('refuses when ADMIN_TOKEN is not set', async () => {
    process.env.ALLOW_SEED = 'true';
    const { POST } = await loadRoute();
    const res = await POST(bearerRequest(ADMIN));
    expect(res.status).toBe(403);
  });

  it('refuses without a bearer token', async () => {
    process.env.ALLOW_SEED = 'true';
    process.env.ADMIN_TOKEN = ADMIN;
    const { POST } = await loadRoute();
    const res = await POST(bearerRequest());
    expect(res.status).toBe(401);
  });

  it('refuses with the wrong bearer token', async () => {
    process.env.ALLOW_SEED = 'true';
    process.env.ADMIN_TOKEN = ADMIN;
    const { POST } = await loadRoute();
    const res = await POST(bearerRequest('y'.repeat(32)));
    expect(res.status).toBe(401);
  });
});
