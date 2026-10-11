import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCategory: vi.fn(), createCategory: vi.fn(), upsertBudget: vi.fn(), getBalances: vi.fn(),
  createGoal: vi.fn(), updateProgress: vi.fn(), updateGoal: vi.fn(), loadPlanningInput: vi.fn(),
}));
vi.mock('@/lib/repos', () => ({
  accountRepo: { getBalances: mocks.getBalances }, journalRepo: {},
  categoryRepo: { getByName: mocks.getCategory, create: mocks.createCategory }, propertyRepo: {}, tipRepo: {},
  budgetRepo: { upsert: mocks.upsertBudget },
  savingsGoalRepo: { create: mocks.createGoal, updateProgress: mocks.updateProgress, update: mocks.updateGoal },
  aiMemoryRepo: {}, ownerTaxRepo: {},
}));
vi.mock('@/lib/planning/load', () => ({ loadPlanningInput: mocks.loadPlanningInput }));
vi.mock('./claude-client', () => ({ categorizeBatch: vi.fn() }));

import { executeTool, TOOL_DEFINITIONS } from './tools';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCategory.mockResolvedValue({ id: 10, name: 'Groceries' });
  mocks.createCategory.mockResolvedValue({ id: 10, name: 'Groceries' });
  mocks.upsertBudget.mockImplementation(async (_id, _limit, effectiveFrom) => ({ id: 20, effective_from: effectiveFrom }));
  mocks.getBalances.mockResolvedValue([{ account_id: 5, account_name: 'Emergency savings', balance: '0', account_type: 'ASSET' }]);
  mocks.createGoal.mockImplementation(async data => ({ id: 30, ...data, status: 'active' }));
  mocks.updateProgress.mockImplementation(async (id, currentAmount) => ({ id, name: 'Reserve', targetAmount: '1000.00', currentAmount, status: 'active' }));
});

const valid = {
  set_budget: { category_name: 'Groceries', monthly_limit: '200.00' },
  set_savings_goal: { name: 'Emergency fund', target_amount: '1000.00', target_date: '2027-02-28' },
  update_savings_progress: { goal_id: 30, current_amount: '250.00' },
};

function expectNoReadsOrWrites() {
  for (const mock of Object.values(mocks)) expect(mock).not.toHaveBeenCalled();
}

describe('AI budget and savings goal validation', () => {
  it.each([
    ['set_budget', { monthly_limit: '-1.00' }],
    ['set_budget', { monthly_limit: '1.005' }],
    ['set_budget', { monthly_limit: '1e3' }],
    ['set_budget', { monthly_limit: Infinity }],
    ['set_budget', { monthly_limit: '1000000000000' }],
    ['set_budget', { category_name: '  ' }],
    ['set_savings_goal', { target_amount: '0' }],
    ['set_savings_goal', { target_amount: '-50' }],
    ['set_savings_goal', { target_amount: '100.999' }],
    ['set_savings_goal', { target_date: '2026-02-30' }],
    ['set_savings_goal', { target_date: '2027-2-28' }],
    ['set_savings_goal', { name: '  ' }],
    ['update_savings_progress', { current_amount: '-0.01' }],
    ['update_savings_progress', { current_amount: '0.001' }],
    ['update_savings_progress', { goal_id: 30.5 }],
    ['update_savings_progress', { goal_id: 0 }],
  ] as Array<[keyof typeof valid, Record<string, unknown>]>)('rejects invalid %s inputs before any read or write (%j)', async (tool, override) => {
    const result = await executeTool(tool, { ...valid[tool], ...override });
    expect(result).toHaveProperty('error');
    expectNoReadsOrWrites();
  });

  it.each(Object.keys(valid) as Array<keyof typeof valid>)('rejects unknown fields in %s rather than silently dropping them', async tool => {
    expect(await executeTool(tool, { ...valid[tool], status: 'completed' })).toHaveProperty('error');
    expectNoReadsOrWrites();
    expect(TOOL_DEFINITIONS.find(def => def.name === tool)?.input_schema.additionalProperties).toBe(false);
  });

  it('normalises a budget and uses a valid London calendar date', async () => {
    const result = await executeTool('set_budget', { category_name: ' Groceries ', monthly_limit: 20 });
    expect(mocks.getCategory).toHaveBeenCalledWith('Groceries');
    expect(mocks.upsertBudget).toHaveBeenCalledWith(10, '20.00', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
    expect(result).toMatchObject({ categoryId: 10, monthlyLimit: '£20.00' });
  });

  it('normalises a goal, preserves a null date and resolves its explicit account', async () => {
    await executeTool('set_savings_goal', {
      name: ' Emergency fund ', target_amount: 1000, target_date: null, account_name: ' Emergency savings ',
    });
    expect(mocks.createGoal).toHaveBeenCalledWith({ name: 'Emergency fund', targetAmount: '1000.00', targetDate: null, accountId: 5 });
  });

  it('does not silently create an unlinked goal when an explicit account is unknown', async () => {
    expect(await executeTool('set_savings_goal', { ...valid.set_savings_goal, account_name: 'Unknown bank' })).toHaveProperty('error');
    expect(mocks.createGoal).not.toHaveBeenCalled();
  });

  it('does not mark a goal completed from rounded progress', async () => {
    const result = await executeTool('update_savings_progress', { goal_id: 30, current_amount: '999.99' });
    expect(mocks.updateProgress).toHaveBeenCalledWith(30, '999.99');
    expect(mocks.updateGoal).not.toHaveBeenCalled();
    expect(result).toMatchObject({ progress: 99.99, status: 'active', milestone: '75% milestone reached!' });
  });

  it('marks a goal completed when its exact balance reaches its target', async () => {
    const result = await executeTool('update_savings_progress', { goal_id: 30, current_amount: 1000 });
    expect(mocks.updateGoal).toHaveBeenCalledWith(30, { status: 'completed' });
    expect(result).toMatchObject({ status: 'completed', milestone: 'Goal completed!' });
  });
});
