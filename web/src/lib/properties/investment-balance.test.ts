import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ propertyRepo: {}, accountRepo: {} }));
vi.mock('./equity-calculator', () => ({ calculateEquity: vi.fn() }));
import { ClientError } from '@/lib/errors';
import { setInvestmentBalance } from './personal-net-worth';

beforeEach(() => vi.resetAllMocks());
describe('investment balance write boundary', () => {
  it('rejects invalid IDs, amounts and calendar dates before database reads for all callers', async () => {
    const valid = { accountId: 1, newBalance: '1000', asOfDate: '2026-10-11' };
    for (const input of [
      { ...valid, accountId: 1.5 }, { ...valid, accountId: -1 }, { ...valid, accountId: 2147483648 },
      { ...valid, newBalance: '1.234' }, { ...valid, newBalance: 'NaN' }, { ...valid, newBalance: '1e3' },
      { ...valid, newBalance: '1000000000000' }, { ...valid, newBalance: '-1000000000000' },
      { ...valid, asOfDate: '2026-02-30' }, { ...valid, asOfDate: '2025-02-29' },
      { ...valid, asOfDate: '0000-01-01' }, { ...valid, description: 'a'.repeat(501) },
    ]) await expect(setInvestmentBalance(input)).rejects.toBeInstanceOf(ClientError);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('preserves valid signed balance targets and normalises the result to pennies', async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [{ id: 1, name: 'Investment', account_type: 'ASSET', is_investment: true, adj_account_id: 2 }] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ journal_id: 5, previous_balance: '1000', delta: '-1100.5' }] });
    await expect(setInvestmentBalance({ accountId: 1, newBalance: ' -100.5 ', asOfDate: '2028-02-29' })).resolves.toEqual({ journalId: 5, previousBalance: '1000.00', delta: '-1100.50' });
  });
});
