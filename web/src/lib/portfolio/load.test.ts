import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { INITIAL_PORTFOLIO, type PortfolioAccount, type PortfolioData, type PortfolioHolding } from './schema';
const execute = vi.fn();
const read = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: (...args: unknown[]) => read(...args) }));
vi.mock('@/lib/dates/today', () => ({ londonTodayIso: () => '2026-10-11' }));
import { loadPortfolioAccounts, loadPortfolioWorkspace, validatePortfolioAgainstAccounts } from './load';
const accounts: PortfolioAccount[] = [{ id: 1, name: 'ISA', investmentKind: 'isa', ownerName: 'Jono', balance: '100.00', balanceAsOf: '2026-10-11' }];
const holding = (patch: Partial<PortfolioHolding> = {}): PortfolioHolding => ({ id: 'fund', accountId: 1, name: 'Fund', assetClass: 'equity', currency: 'GBP', value: '90.00', valuationDate: '2026-10-11', feeRate: null, provider: null, ...patch });
const data = (holdings: PortfolioHolding[]): PortfolioData => ({ holdings, platforms: [] });
beforeEach(() => { execute.mockReset(); read.mockReset(); });
describe('portfolio adapter', () => {
  it('queries only investment ASSET accounts with canonical as-of arithmetic', async () => {
    execute.mockResolvedValue({ rows: [{ id: '1', name: 'ISA', investment_kind: 'isa', owner_name: 'Jono', balance: '123.45' }] });
    const result = await loadPortfolioAccounts('2026-10-11');
    const query = new PgDialect().sqlToQuery(execute.mock.calls[0][0] as SQL);
    expect(query.sql).toContain("a.account_type = 'ASSET'");
    expect(query.sql).toContain('a.is_investment = true');
    expect(query.sql).toContain('v_account_balances');
    expect(query.sql).toContain('future_journal.date >');
    expect(query.params).toContain('2026-10-11');
    expect(result).toEqual([{ ...accounts[0], balance: '123.45' }]);
  });
  it('loads saved and current evidence without revaluing holdings', async () => {
    const workspace = { version: 1, revision: 2, updatedAt: '2026-10-11T12:00:00Z', data: data([holding({ value: '120.00', valuationDate: '2026-09-01' })]) };
    read.mockResolvedValue(workspace);
    execute.mockResolvedValue({ rows: [{ id: 1, name: 'ISA', investment_kind: 'isa', owner_name: 'Jono', balance: '100' }] });
    const result = await loadPortfolioWorkspace();
    expect(result.workspace).toBe(workspace);
    expect(result.analysis.totalOverallocated).toBe('20.00');
    expect(result.analysis.accounts[0].oldestValuationDate).toBe('2026-09-01');
    expect(read.mock.calls[0][0]).toBe('finance.portfolio.v1');
    expect(read.mock.calls[0][2]).toEqual(INITIAL_PORTFOLIO);
  });
  it('rejects invalid balances instead of substituting zero', async () => {
    execute.mockResolvedValue({ rows: [{ id: 1, name: 'ISA', balance: 'NaN' }] });
    await expect(loadPortfolioAccounts()).rejects.toThrow('Invalid investment account balance');
  });
});
describe('portfolio account and snapshot validation', () => {
  it('rejects unknown, non-investment or non-ASSET account IDs', () => {
    expect(validatePortfolioAgainstAccounts(data([holding({ accountId: 999 })]), accounts, '2026-10-11')).toContain('investment ASSET account');
    expect(validatePortfolioAgainstAccounts({ holdings: [], platforms: [{ accountId: 999, feeRate: '0.2' }] }, accounts, '2026-10-11')).toContain('investment ASSET account');
  });
  it('rejects future dates and accepts an older dated snapshot', () => {
    expect(validatePortfolioAgainstAccounts(data([holding({ valuationDate: '2026-10-12' })]), accounts, '2026-10-11')).toContain('future');
    expect(validatePortfolioAgainstAccounts(data([holding({ valuationDate: '2026-09-01' })]), accounts, '2026-10-11')).toBeNull();
  });
  it('rejects fresh over-allocation at pennies precision', () => {
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '100.01' })]), accounts, '2026-10-11')).toContain('£0.01');
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '100.00' })]), accounts, '2026-10-11')).toBeNull();
  });
  it('allows corrections in steps when a ledger change caused an existing excess', () => {
    const previous = data([holding({ value: '130.00' })]);
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '110.00' })]), accounts, '2026-10-11', previous)).toBeNull();
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '130.00' })]), accounts, '2026-10-11', previous)).toContain('exceed');
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '140.00' })]), accounts, '2026-10-11', previous)).toContain('exceed');
  });
  it('does not offset an account excess with another account surplus', () => {
    expect(validatePortfolioAgainstAccounts(data([holding({ value: '101.00' })]), [...accounts, { ...accounts[0], id: 2, balance: '1000.00' }], '2026-10-11')).toContain('ISA');
  });
});
