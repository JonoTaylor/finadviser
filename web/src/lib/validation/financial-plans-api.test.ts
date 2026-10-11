import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  budgets: vi.fn(), status: vi.fn(), upsert: vi.fn(), goals: vi.fn(), create: vi.fn(), update: vi.fn(),
}));
vi.mock('@/lib/repos', () => ({
  budgetRepo: { getAll: mocks.budgets, getStatusForMonth: mocks.status, upsert: mocks.upsert },
  savingsGoalRepo: { getAll: mocks.goals, create: mocks.create, update: mocks.update },
}));
import { GET as getBudgets, POST as saveBudget } from '@/app/api/budgets/route';
import { GET as getBudgetStatus } from '@/app/api/budgets/status/route';
import { GET as getGoals, POST as createGoal, PATCH as updateGoal } from '@/app/api/savings-goals/route';

const request = (body: unknown, method = 'POST') => new NextRequest('http://localhost/api/plans', {
  method, body: typeof body === 'string' ? body : JSON.stringify(body),
});
beforeEach(() => vi.resetAllMocks());

describe('financial plan API boundaries', () => {
  it('keeps genuine empty results separate from unavailable database data', async () => {
    mocks.budgets.mockResolvedValue([]);
    mocks.goals.mockResolvedValue([]);
    mocks.status.mockResolvedValue([]);
    expect((await getBudgets()).status).toBe(200);
    expect((await getGoals()).status).toBe(200);
    const statusRequest = new NextRequest('http://localhost/api/budgets/status?month=2026-10');
    expect((await getBudgetStatus(statusRequest)).status).toBe(200);
    mocks.budgets.mockRejectedValue(new Error('database unavailable'));
    mocks.goals.mockRejectedValue(new Error('database unavailable'));
    mocks.status.mockRejectedValue(new Error('database unavailable'));
    for (const response of [await getBudgets(), await getGoals(), await getBudgetStatus(statusRequest)]) {
      expect(response.status).toBe(503);
      expect(await response.json()).toHaveProperty('error');
    }
  });

  it('rejects invalid month queries before accessing the database', async () => {
    for (const month of ['2026-13', '2026-1', 'October', '2026-00']) {
      const response = await getBudgetStatus(new NextRequest(`http://localhost/api/budgets/status?month=${month}`));
      expect(response.status).toBe(400);
    }
    expect(mocks.status).not.toHaveBeenCalled();
  });

  it('normalises budget money and permits an explicit zero-spending budget', async () => {
    mocks.upsert.mockResolvedValue({ id: 1 });
    expect((await saveBudget(request({ categoryId: 2, monthlyLimit: '250.5', effectiveFrom: '2026-10-01' }))).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(2, '250.50', '2026-10-01');
    expect((await saveBudget(request({ categoryId: 2, monthlyLimit: 0, effectiveFrom: '2026-10-01' }))).status).toBe(200);
    expect(mocks.upsert).toHaveBeenCalledWith(2, '0.00', '2026-10-01');
  });

  it('rejects negative, malformed and over-precision budgets and invalid calendar dates', async () => {
    for (const monthlyLimit of ['-1', 'NaN', '1.234', 'Infinity', '1e3', '1000000000000']) {
      expect((await saveBudget(request({ categoryId: 2, monthlyLimit, effectiveFrom: '2026-10-01' }))).status).toBe(400);
    }
    for (const effectiveFrom of ['2026-02-30', '2025-02-29', '2026-13-01', 'today']) {
      expect((await saveBudget(request({ categoryId: 2, monthlyLimit: 100, effectiveFrom }))).status).toBe(400);
    }
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it('saves goals with trimmed names, normalised amounts and optional dates and account bindings', async () => {
    mocks.create.mockResolvedValue({ id: 3 });
    const response = await createGoal(request({ name: ' Emergency fund ', targetAmount: 12000, currentAmount: '2500.5', targetDate: '2028-02-29', accountId: 2 }));
    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({ name: 'Emergency fund', targetAmount: '12000.00', currentAmount: '2500.50', targetDate: '2028-02-29', accountId: 2 });
  });

  it('rejects goals with zero or negative targets, blank names, invalid IDs and unknown fields', async () => {
    const invalid = [
      { name: 'Goal', targetAmount: 0 }, { name: 'Goal', targetAmount: -1 },
      { name: ' ', targetAmount: 100 }, { name: 'Goal', targetAmount: 100, accountId: -2 },
      { name: 'Goal', targetAmount: 100, createdAt: '2026-10-01' },
    ];
    for (const body of invalid) expect((await createGoal(request(body))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('validates goal patches and only passes supported fields to the repository', async () => {
    mocks.update.mockResolvedValue({ id: 3 });
    expect((await updateGoal(request({ id: 3, currentAmount: '1500.5', status: 'completed' }, 'PATCH'))).status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(3, { currentAmount: '1500.50', status: 'completed' });
    mocks.update.mockClear();
    for (const body of [{ id: 3 }, { id: '3', currentAmount: 100 }, { id: 3, currentAmount: -1 }, { id: 3, status: 'fake' }, { id: 3, createdAt: 'fake' }]) {
      expect((await updateGoal(request(body, 'PATCH'))).status).toBe(400);
    }
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('returns 404 when a patched goal does not exist and 400 for malformed JSON', async () => {
    mocks.update.mockResolvedValue(undefined);
    expect((await updateGoal(request({ id: 8, currentAmount: 100 }, 'PATCH'))).status).toBe(404);
    expect((await updateGoal(request('{broken', 'PATCH'))).status).toBe(400);
    expect((await createGoal(request('{broken'))).status).toBe(400);
    expect((await saveBudget(request('{broken'))).status).toBe(400);
  });
});
