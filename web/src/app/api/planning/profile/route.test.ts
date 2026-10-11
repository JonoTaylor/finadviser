import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const load = vi.fn();
const save = vi.fn();
vi.mock('@/lib/planning/load', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/planning/load')>(),
  loadPlanningProfile: (...args: unknown[]) => load(...args),
  savePlanningProfile: (...args: unknown[]) => save(...args),
}));

import { GET, PUT } from './route';
import { InvalidPlanningProfileError } from '@/lib/planning/load';

const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/planning/profile', {
  method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body),
}));

const scenario = {
  currentAge: 35, retirementAge: 65, currentPot: 40000, monthlyContribution: 300,
  monthlyEmployerContribution: 200, annualGrowthRate: 5, annualFeeRate: 0.5,
  inflationRate: 2.5, desiredAnnualIncome: 30000, expectedAnnualStatePension: 0,
  statePensionAge: 68, withdrawalRate: 3.5, sensitivitySpread: 2,
};

beforeEach(() => {
  load.mockReset();
  save.mockReset().mockResolvedValue(undefined);
});

describe('planning profile API', () => {
  it('returns saved status and unknown profile values', async () => {
    load.mockResolvedValue({ profile: { essentialMonthlySpending: null }, saved: false });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ profile: { essentialMonthlySpending: null }, saved: false });
  });

  it('accepts complete pension assumptions, risk and horizon while keeping omitted facts unknown', async () => {
    const response = await put({ essentialMonthlySpending: 1500, investmentHorizonYears: 10, riskTolerance: 'low', retirementScenario: scenario });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ saved: true, profile: { essentialMonthlySpending: 1500, retirementScenario: scenario, statePensionAnnual: null, emergencyFundMonths: 3 } });
    expect(save).toHaveBeenCalledWith(body.profile);
  });

  it('can save a pension scenario retiring at the current age', async () => {
    const response = await put({ currentAge: 65, retirementAge: 65, retirementScenario: { ...scenario, currentAge: 65, retirementAge: 65 } });
    expect(response.status).toBe(200);
  });

  it.each([
    { riskTolerance: 'speculative' }, { investmentHorizonYears: -5 },
    { emergencyFundMonths: 100 }, { essentialMonthlySpending: -1 },
    { monthlyPensionContribution: '100' }, { currentAge: 40, retirementAge: 30 },
    { arbitrary: 1 }, { retirementScenario: { ...scenario, annualGrowthRate: 100 } },
    { retirementScenario: { ...scenario, arbitrary: 1 } },
  ])('rejects unsafe or unknown profile inputs before writes: %j', async body => {
    const response = await put(body);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('PROFILE_VALIDATION_FAILED');
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before writes', async () => {
    const response = await put('{broken');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON body' });
    expect(save).not.toHaveBeenCalled();
  });

  it('returns 503 on failed read or write and does not claim the profile was saved', async () => {
    load.mockRejectedValue(new Error('postgres://sensitive'));
    save.mockRejectedValue(new Error('network failed'));
    expect((await GET()).status).toBe(503);
    const response = await put({});
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body.code).toBe('DATABASE_UNAVAILABLE');
    expect(body.saved).toBeUndefined();
  });

  it('permits replacing a corrupt profile via PUT', async () => {
    load.mockRejectedValue(new InvalidPlanningProfileError());
    expect((await GET()).status).toBe(500);
    expect((await put({ riskTolerance: 'medium' })).status).toBe(200);
  });
});
