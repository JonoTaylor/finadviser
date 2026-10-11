import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: mocks.getDb, schema: { budgets: {} } }));
import { budgetRepo } from './budget.repo';

beforeEach(() => vi.resetAllMocks());
describe('budget month validation', () => {
  it('rejects malformed and out-of-range months before opening a database connection', async () => {
    for (const month of ['2026', '2026-0', '2026-00', '2026-13', '2026-01-01', 'anything']) {
      await expect(budgetRepo.getStatusForMonth(month)).rejects.toThrow('expected YYYY-MM');
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
