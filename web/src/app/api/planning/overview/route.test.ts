import { beforeEach, describe, expect, it, vi } from 'vitest';

const load = vi.fn();
const build = vi.fn();
vi.mock('@/lib/planning/load', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/planning/load')>(),
  loadPlanningInput: (...args: unknown[]) => load(...args),
}));
vi.mock('@/lib/planning/engine', () => ({ buildFinancialPlan: (...args: unknown[]) => build(...args) }));

import { GET } from './route';
import { InvalidPlanningDataError, InvalidPlanningProfileError } from '@/lib/planning/load';

beforeEach(() => {
  load.mockReset();
  build.mockReset();
});

describe('GET /api/planning/overview', () => {
  it('returns the deterministic plan with its actual data scope and assumptions', async () => {
    const input = { asOf: '2026-10-11', profile: { riskTolerance: null }, transactions: [] };
    const source = { scope: 'household', warnings: ['Incomplete imports'] };
    load.mockResolvedValue({ input, source, profileSaved: false });
    build.mockReturnValue({ currency: 'GBP', actions: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual({ status: 'ready', profile: input.profile, profileSaved: false, source, plan: { currency: 'GBP', actions: [] } });
    expect(build).toHaveBeenCalledWith(input);
  });

  it('returns an honest 503 for missing database configuration without an empty plan or leaking error details', async () => {
    load.mockRejectedValue(new Error('DATABASE_URL missing postgres://secret:password@host'));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ status: 'unavailable', code: 'DATABASE_UNAVAILABLE' });
    expect(body.error).not.toContain('password');
    expect(body.plan).toBeUndefined();
    expect(build).not.toHaveBeenCalled();
  });

  it('identifies a corrupt profile instead of resetting user assumptions', async () => {
    load.mockRejectedValue(new InvalidPlanningProfileError());
    const response = await GET();
    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe('PROFILE_INVALID');
  });

  it('reports invalid ledger inputs separately from a database outage', async () => {
    load.mockRejectedValueOnce(new InvalidPlanningDataError());
    const badData = await GET();
    expect(badData.status).toBe(422);
    expect((await badData.json()).code).toBe('LEDGER_VALIDATION_FAILED');
    load.mockResolvedValue({ input: {}, source: {}, profileSaved: false });
    build.mockImplementation(() => { throw new Error('Invalid date'); });
    expect((await GET()).status).toBe(422);
  });
});
