import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_JOB_TOTALS } from './types';

const mocks = vi.hoisted(() => ({ execute: vi.fn(), counts: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
vi.mock('../repository', () => ({ categorizationRepo: { counts: mocks.counts } }));
vi.mock('../service', () => ({ processCategorization: vi.fn() }));
import { categorizationJobRepo } from './repository';
import { getCategorizationJob } from './service';
import { categorizationJobSchema } from './schema';

const id = 'e5dc57cc-19e1-425c-bbeb-e04cc8ee0f60';
const rawRow = (timestamps: Record<string, unknown> = {}) => ({
  id, status: 'completed', control_action: null, counts_exact: true, passes: 3,
  totals: { ...EMPTY_JOB_TOTALS, aiCategorized: 201 }, latest_result: null,
  max_journal_id: 201, pause_reason: null, dispatch_issue: null,
  created_at: '2026-10-24 18:30:12.123456+00',
  updated_at: '2026-10-24 19:31:13.987654+01',
  finished_at: '2026-10-24 18:32:14+00',
  lease_token: null, lease_expires_at: '2026-10-24 18:33:15.000001+00', pass_limit: 200,
  ...timestamps,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.execute.mockResolvedValue({ rows: [rawRow()] });
  mocks.counts.mockResolvedValue({ remaining: 23, available: 0, needsReview: 23, scopeAvailable: 0 });
});

describe('categorisation job timestamp decoding across database drivers', () => {
  it('normalises raw Neon HTTP PostgreSQL timestamp strings before the public DTO is validated', async () => {
    const job = await getCategorizationJob(id);
    expect(job).toMatchObject({
      createdAt: '2026-10-24T18:30:12.123Z', updatedAt: '2026-10-24T18:31:13.987Z',
      finishedAt: '2026-10-24T18:32:14.000Z', leaseExpiresAt: '2026-10-24T18:33:15.000Z',
      status: 'completed', passes: 3, totals: { aiCategorized: 201 },
    });
    expect(categorizationJobSchema.safeParse(job).success).toBe(true);
  });

  it('continues to support node-postgres Date values and nullable timestamps', async () => {
    mocks.execute.mockResolvedValue({ rows: [rawRow({
      created_at: new Date('2026-10-24T18:30:12.123Z'), updated_at: new Date('2026-10-24T18:31:13.987Z'),
      finished_at: null, lease_expires_at: null,
    })] });
    const job = await getCategorizationJob(id);
    expect(job).toMatchObject({ createdAt: '2026-10-24T18:30:12.123Z', finishedAt: null, leaseExpiresAt: null });
    expect(categorizationJobSchema.safeParse(job).success).toBe(true);
  });

  it('does not fabricate timestamps for invalid database values', async () => {
    mocks.execute.mockResolvedValue({ rows: [rawRow({ created_at: 'invalid', lease_expires_at: new Date(NaN) })] });
    const job = await categorizationJobRepo.get(id);
    expect(job?.createdAt).toBeNull();
    expect(job?.leaseExpiresAt).toBeNull();
  });
});
