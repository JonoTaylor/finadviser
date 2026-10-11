import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), owners: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { listOwners: mocks.owners } }));
import { loadContextLookup } from './lookup';

const row = {
  id: 1, name: 'Cash', account_type: 'ASSET', is_investment: false, investment_kind: null,
  owner_id: null, balance: '1250.50', is_property_asset: false,
  latest_journal_date: '2026-10-10', posting_count: '5', future_posting_count: '1',
};

beforeEach(() => {
  mocks.execute.mockReset().mockResolvedValue({ rows: [row] });
  mocks.owners.mockReset().mockResolvedValue([{ id: 7, name: 'Other owner' }, { id: 9, name: 'Jono' }]);
});

describe('context ledger lookup', () => {
  it('retains real owner IDs and signed balances without inferring the user owner', async () => {
    const result = await loadContextLookup(new Date('2026-10-11T12:00:00Z'));
    expect(result).toEqual({ asOf: '2026-10-11', owners: [{ id: 7, name: 'Other owner' }, { id: 9, name: 'Jono' }], accounts: [{
      id: 1, name: 'Cash', accountType: 'ASSET', isInvestment: false, investmentKind: null,
      ownerId: null, balance: '1250.50', isPropertyAsset: false, latestJournalDate: '2026-10-10', postingCount: 5, futurePostingCount: 1,
    }] });
    const query = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    expect(query.sql).toContain('future_journal.date >');
    expect(query.sql).toContain('MAX(j.date)');
    expect(query.sql).toContain('j.date <=');
    expect(query.params).toContain('2026-10-11');
  });

  it('uses the London date at a UTC midnight boundary', async () => {
    expect((await loadContextLookup(new Date('2026-06-10T23:30:00Z'))).asOf).toBe('2026-06-11');
  });

  it('keeps absent posting dates unknown and liabilities signed', async () => {
    mocks.execute.mockResolvedValue({ rows: [{ ...row, account_type: 'LIABILITY', balance: '-600.00', latest_journal_date: null, posting_count: '0' }] });
    expect((await loadContextLookup()).accounts[0]).toMatchObject({ balance: '-600.00', latestJournalDate: null, postingCount: 0 });
  });

  it('propagates failed reads and rejects nonfinite balances', async () => {
    mocks.execute.mockRejectedValueOnce(new Error('offline'));
    await expect(loadContextLookup()).rejects.toThrow('offline');
    mocks.execute.mockResolvedValue({ rows: [{ ...row, balance: 'Infinity' }] });
    await expect(loadContextLookup()).rejects.toThrow('balance is invalid');
  });
});
