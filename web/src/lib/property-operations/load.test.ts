import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
const execute = vi.fn();
const read = vi.fn();
const list = vi.fn();
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute }) }));
vi.mock('@/lib/finance-workspace/store', () => ({ readWorkspace: (...args: unknown[]) => read(...args) }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listProperties: (...args: unknown[]) => list(...args) } }));

import { loadPropertyOperationsWorkspace } from './load';
import { PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations } from './types';

beforeEach(() => {
  read.mockReset().mockResolvedValue({ version: 1, revision: 2, updatedAt: '2026-10-01T12:00:00Z', data: initialPropertyOperations });
  list.mockReset().mockResolvedValue([{ id: 1, name: 'Flat' }]);
  execute.mockReset()
    .mockResolvedValueOnce({ rows: [{ id: 1, propertyId: 1, tenantName: 'Tenant', startDate: '2026-01-15', endDate: null, rentAmount: '1000.00', rentFrequency: 'monthly' }] })
    .mockResolvedValueOnce({ rows: [{ propertyId: 1, date: '2026-09-15', amount: '900.00' }] })
    .mockResolvedValueOnce({ rows: [{ propertyId: 1, date: '2026-09-15' }] })
    .mockResolvedValueOnce({ rows: [{ id: 1, valuation: '200000.00', valuationDate: '2026-09-01', mortgageDebt: '120000.00' }] });
});

describe('property operations loader', () => {
  it('combines actual recorded rows with a versioned user workspace', async () => {
    const result = await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    expect(read).toHaveBeenCalledWith(PROPERTY_OPERATIONS_KEY, propertyOperationsSchema, initialPropertyOperations);
    expect(result).toMatchObject({ revision: 2, summary: { asOf: '2026-10-11', comparison: { month: '2026-09' } } });
    expect(result.summary.properties[0]).toMatchObject({ recordedIncome: '900.00', unreconciledRentGap: '100.00', loanToValuePercent: '60.0' });
  });

  it('uses the London calendar during the BST midnight boundary', async () => {
    const result = await loadPropertyOperationsWorkspace(new Date('2026-09-30T23:30:00Z'));
    expect(result.summary.asOf).toBe('2026-10-01');
    expect(result.summary.comparison.month).toBe('2026-09');
  });

  it('scopes property income to the completed month, excludes transfers, offsets refunds and cuts future mortgage and valuation dates', async () => {
    await loadPropertyOperationsWorkspace(new Date('2026-10-11T12:00:00Z'));
    const dialect = new PgDialect();
    const queries = execute.mock.calls.map(([query]) => dialect.sqlToQuery(query));
    expect(queries[1].sql).toContain("a.account_type = 'INCOME'");
    expect(queries[1].sql).toContain('(-be.amount::numeric)');
    expect(queries[1].sql).toContain('COALESCE(je.is_transfer, FALSE) = FALSE');
    expect(queries[1].params).toEqual(['2026-09-01', '2026-09-30']);
    expect(queries[3].sql).toContain('pv.valuation_date <=');
    expect(queries[3].sql).toContain('je.date >');
    expect(queries[3].sql).toContain('SELECT DISTINCT liability_account_id');
    expect(queries[3].params.every(value => value === '2026-10-11')).toBe(true);
  });

  it('propagates failures instead of constructing an empty property portfolio', async () => {
    list.mockRejectedValue(new Error('unavailable'));
    await expect(loadPropertyOperationsWorkspace()).rejects.toThrow('unavailable');
  });
});
