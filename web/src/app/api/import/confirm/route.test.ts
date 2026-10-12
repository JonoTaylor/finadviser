import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ csv: vi.fn(), parsed: vi.fn() }));
vi.mock('@/lib/import/import-pipeline', () => ({ executeImport: mocks.csv, executeImportFromParsed: mocks.parsed }));

import { POST } from './route';

const request = (body: unknown) => new NextRequest('http://localhost/api/import/confirm', { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const readEvents = async (response: Response) => (await response.text()).trim().split('\n').map(line => JSON.parse(line));
const result = {
  batchId: 12, importedCount: 1, duplicateCount: 0, totalCount: 1,
  categorization: { status: 'unavailable', remaining: null, aiSkippedReason: 'model_not_configured', reviewUrl: '/data' },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.parsed.mockImplementation(async (_rows, _account, save, categorize) => { save(0, 1); save(1, 1); categorize(1); return result; });
  mocks.csv.mockImplementation(async (_csv, _bank, _account, save, categorize) => { save(0, 1); save(1, 1); categorize(1); return result; });
});

describe('honest import progress and terminal outcomes', () => {
  it('emits processing only after saving and finishes successfully when AI is unavailable', async () => {
    const response = await POST(request({ parsedTransactions: [{}], accountName: 'Monzo' }));
    const events = await readEvents(response);
    expect(events.map(event => event.phase)).toEqual(['checking-duplicates', 'saving', 'saving', 'categorising', 'done']);
    expect(events.at(-1)).toEqual({ phase: 'done', result });
    expect(response.headers.get('Content-Type')).toContain('application/x-ndjson');
  });

  it('uses the same awaited processing stage for CSV imports', async () => {
    const events = await readEvents(await POST(request({ csvContent: 'csv', bankConfig: 'generic-csv', accountName: 'Monzo' })));
    expect(events.map(event => event.phase)).toEqual(['parsing', 'checking-duplicates', 'saving', 'saving', 'categorising', 'done']);
    expect(mocks.csv).toHaveBeenCalledOnce();
  });

  it('rejects malformed input before invoking either import pipeline', async () => {
    const response = await POST(request({ parsedTransactions: 'bad', accountName: 'Monzo' }));
    expect(response.status).toBe(400);
    expect(mocks.csv).not.toHaveBeenCalled();
    expect(mocks.parsed).not.toHaveBeenCalled();
  });
});
