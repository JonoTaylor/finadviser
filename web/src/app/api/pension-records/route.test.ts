import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({ load: vi.fn(), references: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/pension-records/load', () => ({
  loadPensionRecordsWorkspace: mocks.load,
  loadPensionRecordReferences: mocks.references,
}));
vi.mock('@/lib/finance-workspace/store', () => ({
  writeWorkspace: mocks.write,
}));
vi.mock('@/lib/finance-workspace/api', () => ({
  workspaceErrorResponse: (error: unknown) => NextResponse.json({ error: error instanceof Error && error.message === 'conflict' ? 'Another change was saved first' : 'Workspace unavailable' }, { status: error instanceof Error && error.message === 'conflict' ? 409 : 503 }),
}));
import { GET, PUT } from './route';
import { PENSION_RECORDS_KEY, pensionRecordsDataSchema } from '@/lib/pension-records/schema';

const dc = {
  id: '00000000-0000-4000-8000-000000000001', type: 'dc', name: 'My pension', provider: 'Provider', ownerId: 1,
  statementAsOf: null, notes: null, linkedAccountId: 4, potAmount: null, personalMonthlyContribution: '125.25', employerMonthlyContribution: null, annualFeeRate: null,
};
const put = (body: unknown) => PUT(new NextRequest('http://localhost/api/pension-records', { method: 'PUT', body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  mocks.load.mockReset(); mocks.references.mockReset(); mocks.write.mockReset();
  mocks.references.mockResolvedValue({ owners: [{ id: 1, name: 'Jono' }], pensionAccounts: [{ id: 4, name: 'Ledger pension', ownerId: 1, ownerName: 'Jono', balance: '50000.50', balanceAsOf: '2026-10-11' }] });
  mocks.write.mockImplementation(async (_key, _schema, data, revision) => ({ version: 1, revision: revision + 1, updatedAt: '2026-10-11T12:00:00Z', data }));
});

describe('pension records API', () => {
  it('reads the inventory envelope and separate summaries without caching personal data', async () => {
    mocks.load.mockResolvedValue({ workspace: { version: 1, revision: 0, updatedAt: null, data: [] }, owners: [], pensionAccounts: [], summary: { scope: 'household' } });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await response.json()).workspace.revision).toBe(0);
  });

  it('passes the expected revision to CAS storage and returns authoritative ledger pot values', async () => {
    const response = await put({ data: [dc], revision: 2 });
    expect(response.status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(PENSION_RECORDS_KEY, pensionRecordsDataSchema, [dc], 2);
    const result = await response.json();
    expect(result.workspace.revision).toBe(3);
    expect(result.summary.dc.pot.knownTotal).toBe('50000.50');
    expect(result.summary.dc.totalMonthlyContributions.knownTotal).toBeNull();
  });

  it('saves income records separately and permits removing descriptive records', async () => {
    const db = { id: dc.id, type: 'db', name: 'Final salary scheme', provider: null, ownerId: 1, statementAsOf: null, notes: null, promisedAnnualIncome: '8000.00', startAge: 62 };
    const response = await put({ data: [db], revision: 0 });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.summary.dc.pot.knownTotal).toBeNull();
    expect(result.summary.db.annualIncome.knownTotal).toBe('8000.00');
    expect((await put({ data: [], revision: 1 })).status).toBe(200);
  });

  it.each([
    { data: [dc], revision: -1 }, { data: [dc], revision: 0, extra: true },
    { data: [{ ...dc, potAmount: '-10' }], revision: 0 }, { data: [dc, dc], revision: 0 },
    { data: [{ ...dc, type: 'db' }], revision: 0 }, { data: [dc] },
  ])('rejects invalid bodies before reads and writes: %j', async body => {
    expect((await put(body)).status).toBe(400);
    expect(mocks.references).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON before reading or writing', async () => {
    expect((await put('{broken')).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it.each([{ ownerId: 99 }, { ownerId: null }, { linkedAccountId: 99 }])('rejects unavailable or mismatching relationships: %j', async overrides => {
    expect((await put({ data: [{ ...dc, ...overrides }], revision: 0 })).status).toBe(400);
    expect(mocks.write).not.toHaveBeenCalled();
  });

  it('surfaces revision conflicts without reporting a successful save', async () => {
    mocks.write.mockRejectedValue(new Error('conflict'));
    const response = await put({ data: [dc], revision: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Another change was saved first' });
  });

  it('keeps unavailable reads and writes distinct from empty inventories and hides internal errors', async () => {
    mocks.load.mockRejectedValue(new Error('postgres://secret'));
    mocks.write.mockRejectedValue(new Error('postgres://secret'));
    expect((await GET()).status).toBe(503);
    const response = await put({ data: [dc], revision: 0 });
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain('secret');
  });
});
