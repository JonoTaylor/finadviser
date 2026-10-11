import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import type { PortfolioData, PortfolioHolding } from '@/lib/portfolio/schema';
const read = vi.fn();
const write = vi.fn();
const loadAccounts = vi.fn();
const loadWorkspace = vi.fn();
vi.mock('@/lib/finance-workspace/store', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/finance-workspace/store')>(),
  readWorkspace: (...args: unknown[]) => read(...args), writeWorkspace: (...args: unknown[]) => write(...args),
}));
vi.mock('@/lib/portfolio/load', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/portfolio/load')>(),
  loadPortfolioAccounts: (...args: unknown[]) => loadAccounts(...args), loadPortfolioWorkspace: (...args: unknown[]) => loadWorkspace(...args),
}));
vi.mock('@/lib/dates/today', () => ({ londonTodayIso: () => '2026-10-11' }));
import { WorkspaceConflictError, WorkspaceStoredDataError } from '@/lib/finance-workspace/store';
import { GET, PUT } from './route';
const holding: PortfolioHolding = { id: 'fund', accountId: 1, name: 'Fund', assetClass: 'equity', currency: 'GBP', value: '90.00', valuationDate: '2026-10-11', feeRate: null, provider: null };
const initial: PortfolioData = { holdings: [], platforms: [] };
const envelope = (data: PortfolioData = initial, revision = 0) => ({ version: 1, revision, updatedAt: revision ? '2026-10-11T12:00:00Z' : null, data });
const request = (body: unknown) => new NextRequest('http://localhost/api/portfolio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
beforeEach(() => {
  read.mockReset(); write.mockReset(); loadAccounts.mockReset(); loadWorkspace.mockReset();
  read.mockResolvedValue(envelope());
  loadAccounts.mockResolvedValue([{ id: 1, name: 'ISA', investmentKind: 'isa', ownerName: 'Jono', balance: '100.00', balanceAsOf: '2026-10-11' }]);
  write.mockImplementation(async (_key, _schema, data, revision) => envelope(data, revision + 1));
});
describe('/api/portfolio', () => {
  it('returns saved and current evidence without caching', async () => {
    const expected = { workspace: envelope(), accounts: [], analysis: { totalLedgerBalance: '0.00' } };
    loadWorkspace.mockResolvedValue(expected);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(expected);
  });
  it('fails honestly without exposing credentials or a fabricated zero portfolio', async () => {
    loadWorkspace.mockRejectedValue(new Error('postgres://secret:password@db'));
    const response = await GET();
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.code).toBe('WORKSPACE_UNAVAILABLE');
    expect(body.error).not.toContain('password');
    expect(body.analysis).toBeUndefined();
  });
  it('validates foreign holding IDs before the CAS writer', async () => {
    expect((await PUT(request({ data: { ...initial, holdings: [{ ...holding, accountId: 2 }] }, revision: 0 }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it('validates foreign platform IDs before writes', async () => {
    expect((await PUT(request({ data: { ...initial, platforms: [{ accountId: 2, feeRate: '0.2' }] }, revision: 0 }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects future and invalid calendar valuation dates', async () => {
    for (const valuationDate of ['2026-10-12', '2026-02-30']) expect((await PUT(request({ data: { ...initial, holdings: [{ ...holding, valuationDate }] }, revision: 0 }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects new holdings above the current account balance', async () => {
    expect((await PUT(request({ data: { ...initial, holdings: [{ ...holding, value: '100.01' }] }, revision: 0 }))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it('accepts old statements below balance and preserves unknown fees', async () => {
    const response = await PUT(request({ data: { ...initial, holdings: [{ ...holding, valuationDate: '2026-09-01' }] }, revision: 0 }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workspace.revision).toBe(1);
    expect(body.workspace.data.holdings[0].feeRate).toBeNull();
    expect(body.analysis.totalLedgerBalance).toBe('100.00');
    expect(body.analysis.totalAllocated).toBe('90.00');
    expect(body.analysis.accounts[0].datesMatchLedger).toBe(false);
    expect(write.mock.calls[0][0]).toBe('finance.portfolio.v1');
    expect(write.mock.calls[0][3]).toBe(0);
  });
  it('permits a correction-only reduction to an existing ledger mismatch', async () => {
    read.mockResolvedValue(envelope({ ...initial, holdings: [{ ...holding, value: '130.00' }] }, 2));
    expect((await PUT(request({ data: { ...initial, holdings: [{ ...holding, value: '110.00' }] }, revision: 2 }))).status).toBe(200);
  });
  it('rejects unknown fields, duplicate IDs, invalid amounts and revisions', async () => {
    for (const body of [
      { data: { ...initial, fakeAssets: '100' }, revision: 0 },
      { data: { ...initial, holdings: [holding, holding] }, revision: 0 },
      { data: { ...initial, holdings: [{ ...holding, value: '-1' }] }, revision: 0 },
      { data: { ...initial, holdings: [{ ...holding, feeRate: 'not-a-number' }] }, revision: 0 },
      { data: { ...initial, holdings: [holding] }, revision: -1 },
      { data: { ...initial, holdings: [holding] }, revision: 0, force: true },
    ]) expect((await PUT(request(body))).status).toBe(400);
    expect(write).not.toHaveBeenCalled();
  });
  it('reports concurrent edits as a conflict without claiming a save', async () => {
    write.mockRejectedValue(new WorkspaceConflictError());
    const response = await PUT(request({ data: { ...initial, holdings: [holding] }, revision: 0 }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('WORKSPACE_CONFLICT');
  });
  it('does not replace corrupt stored records', async () => {
    read.mockRejectedValue(new WorkspaceStoredDataError());
    expect((await PUT(request({ data: initial, revision: 0 }))).status).toBe(422);
    expect(write).not.toHaveBeenCalled();
  });
  it('rejects malformed JSON before querying balances', async () => {
    expect((await PUT(new NextRequest('http://localhost/api/portfolio', { method: 'PUT', body: '{' }))).status).toBe(400);
    expect(loadAccounts).not.toHaveBeenCalled();
  });
});
