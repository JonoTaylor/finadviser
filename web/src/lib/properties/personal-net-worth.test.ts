import Decimal from 'decimal.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  execute: vi.fn(), getOwner: vi.fn(), listProperties: vi.fn(), calculateEquity: vi.fn(),
}));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos', () => ({ propertyRepo: {
  getOwner: mocks.getOwner, listProperties: mocks.listProperties,
} }));
vi.mock('./equity-calculator', () => ({ calculateEquity: mocks.calculateEquity }));
import { calculatePersonalNetWorth } from './personal-net-worth';

const account = (id: number, account_type: string, balance: string, owner_id: number | null = 1, investment = false) => ({
  id, name: `Account ${id}`, account_type, balance, owner_id,
  is_investment: investment, investment_kind: investment ? 'pension' : null,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getOwner.mockResolvedValue({ id: 1, name: 'Owner' });
  mocks.listProperties.mockResolvedValue([]);
  mocks.execute.mockResolvedValue({ rows: [] });
});

describe('personal net worth', () => {
  it('deducts personal debt while retaining existing property equity, investments and cash', async () => {
    mocks.listProperties.mockResolvedValue([{ id: 10, name: 'Home' }]);
    mocks.calculateEquity.mockResolvedValue([{ ownerId: 1, equityPct: 50, equityAmount: new Decimal('100000') }]);
    mocks.execute.mockResolvedValue({ rows: [
      account(1, 'ASSET', '3000'), account(2, 'ASSET', '20000', 1, true), account(3, 'LIABILITY', '-4000'),
    ] });
    const result = await calculatePersonalNetWorth(1);
    expect(result).toMatchObject({
      propertyEquity: '100000.00', investments: '20000.00', personalCash: '3000.00',
      personalLiabilities: '4000.00', total: '119000.00',
      perLiability: [{ accountId: 3, name: 'Account 3', balance: '4000.00' }],
    });
    expect(result?.perInvestment[0].investmentKind).toBe('pension');
  });

  it('preserves credit balances and overdrafts rather than turning all balances into debts or assets', async () => {
    mocks.execute.mockResolvedValue({ rows: [
      account(1, 'ASSET', '-500'), account(2, 'LIABILITY', '-1000'), account(3, 'LIABILITY', '200'),
    ] });
    const result = await calculatePersonalNetWorth(1);
    expect(result?.personalCash).toBe('-500.00');
    expect(result?.personalLiabilities).toBe('800.00');
    expect(result?.total).toBe('-1300.00');
    expect(result?.perLiability.map(d => d.balance)).toEqual(['1000.00', '-200.00']);
  });

  it('reports shared cash and shared debt separately without attributing either to the owner', async () => {
    mocks.execute.mockResolvedValue({ rows: [
      account(1, 'ASSET', '10000', null), account(2, 'LIABILITY', '-5000', null),
      account(3, 'ASSET', '50000', 2, true), account(4, 'LIABILITY', '-4000', 2),
    ] });
    const result = await calculatePersonalNetWorth(1);
    expect(result?.sharedCashUnattributed).toBe('10000.00');
    expect(result?.sharedLiabilitiesUnattributed).toBe('5000.00');
    expect(result?.total).toBe('0.00');
    expect(result?.perLiability).toEqual([]);
  });

  it('returns null for an unknown owner without loading accounts or properties', async () => {
    mocks.getOwner.mockResolvedValue(null);
    expect(await calculatePersonalNetWorth(9)).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.listProperties).not.toHaveBeenCalled();
  });
});
