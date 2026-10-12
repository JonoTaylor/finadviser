import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AggregatorTransaction } from './aggregator';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), getConnection: vi.fn(), listAccounts: vi.fn(), listTransactions: vi.fn(), getByName: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('./repo', () => ({ bankingRepo: { getConnection: mocks.getConnection, listProviderAccounts: mocks.listAccounts } }));
vi.mock('./dispatch', () => ({ listTransactionsForConnection: mocks.listTransactions }));
vi.mock('@/lib/repos', () => ({ accountRepo: { getByName: mocks.getByName } }));

import { syncConnection } from './sync';

const txn = (patch: Partial<AggregatorTransaction> = {}): AggregatorTransaction => ({
  aggregatorTxnId: 'bank-1', date: '2026-10-12', amount: '-50.10', currency: 'GBP',
  originalAmount: null, originalCurrency: null, fxRate: null, description: 'Card payment',
  merchantName: 'Grocer', status: 'settled', bankCategory: 'groceries', raw: {}, ...patch,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getConnection.mockResolvedValue({ id: 1, status: 'active', lastSyncedAt: null });
  mocks.listAccounts.mockResolvedValue([{ accountId: 7, aggregatorAccountRef: 'bank-account', cutoverDate: null }]);
  mocks.getByName.mockImplementation(async name => ({ id: name === 'Uncategorized Income' ? 8 : 9 }));
});

describe('scoped processing IDs from idempotent bank ingestion', () => {
  it('collects only inserted journal IDs and leaves monetary ingestion unchanged', async () => {
    mocks.listTransactions.mockResolvedValue([txn(), txn({ aggregatorTxnId: 'bank-2', amount: '50.10' })]);
    mocks.execute.mockResolvedValueOnce({ rows: [{ journal_id: 100, was_inserted: true }] });
    mocks.execute.mockResolvedValueOnce({ rows: [{ journal_id: 101, was_inserted: false }] });
    expect(await syncConnection(1, 12)).toEqual({ txnsAdded: 1, txnsUpdated: 0, journalIds: [100] });
    const first = new PgDialect().sqlToQuery(mocks.execute.mock.calls[0][0]);
    const second = new PgDialect().sqlToQuery(mocks.execute.mock.calls[1][0]);
    expect(first.sql).toContain('ingest_bank_transaction');
    expect(first.params.slice(0, 8)).toEqual(['bank-1', 7, 9, '2026-10-12', 'Grocer', '-50.10', 12, 'bank-1']);
    expect(second.params.slice(0, 8)).toEqual(['bank-2', 7, 8, '2026-10-12', 'Grocer', '50.10', 12, 'bank-2']);
  });

  it('does not turn already-ingested transactions into a new processing scope on retry', async () => {
    mocks.listTransactions.mockResolvedValue([txn()]);
    mocks.execute.mockResolvedValue({ rows: [{ journal_id: 100, was_inserted: false }] });
    expect(await syncConnection(1, 13)).toEqual({ txnsAdded: 0, txnsUpdated: 0, journalIds: [] });
  });

  it('keeps an unmapped connection empty without a provider call', async () => {
    mocks.listAccounts.mockResolvedValue([]);
    expect(await syncConnection(1, 13)).toEqual({ txnsAdded: 0, txnsUpdated: 0, journalIds: [] });
    expect(mocks.listTransactions).not.toHaveBeenCalled();
  });
});
