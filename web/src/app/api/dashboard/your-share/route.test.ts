import { NextRequest } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
const { listOwners, loadFinancialContext, calculatePersonalNetWorth } = vi.hoisted(() => ({ listOwners: vi.fn(), loadFinancialContext: vi.fn(), calculatePersonalNetWorth: vi.fn() }));
vi.mock('@/lib/repos', () => ({ propertyRepo: { listOwners } }));
vi.mock('@/lib/finance-context', () => ({ loadFinancialContext }));
vi.mock('@/lib/properties/personal-net-worth', () => ({ calculatePersonalNetWorth }));
import { GET } from './route';
beforeEach(() => {
  vi.clearAllMocks();
  listOwners.mockResolvedValue([{ id: 1, name: 'Alice' }, { id: 2, name: 'Jono' }]);
  loadFinancialContext.mockResolvedValue({ data: { ownerId: null } });
  calculatePersonalNetWorth.mockImplementation(async id => ({ ownerId: id, total: '12.34' }));
});
it('requires an explicitly selected person and never defaults to the first owner', async () => {
  const response = await GET(new NextRequest('http://localhost/api/dashboard/your-share'));
  expect(await response.json()).toMatchObject({ requiresOwnerSelection: true, yourShare: null });
  expect(calculatePersonalNetWorth).not.toHaveBeenCalled();
});
it('uses the saved identity while keeping explicit browsing possible', async () => {
  loadFinancialContext.mockResolvedValue({ data: { ownerId: 2 } });
  expect(await (await GET(new NextRequest('http://localhost/api/dashboard/your-share'))).json()).toMatchObject({ yourShare: { ownerId: 2 } });
  expect(await (await GET(new NextRequest('http://localhost/api/dashboard/your-share?ownerId=1'))).json()).toMatchObject({ yourShare: { ownerId: 1 } });
});
it.each(['2junk', '0', '-1', '1.5'])('rejects malformed owner identity %s', async id => {
  expect((await GET(new NextRequest(`http://localhost/api/dashboard/your-share?ownerId=${id}`))).status).toBe(400);
});
it('flags a saved owner that no longer exists', async () => {
  loadFinancialContext.mockResolvedValue({ data: { ownerId: 3 } });
  expect((await GET(new NextRequest('http://localhost/api/dashboard/your-share'))).status).toBe(422);
});
it('does not return a false personal zero after storage failure', async () => {
  loadFinancialContext.mockRejectedValue(new Error('private connection secret'));
  const response = await GET(new NextRequest('http://localhost/api/dashboard/your-share'));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain('private connection secret');
});
