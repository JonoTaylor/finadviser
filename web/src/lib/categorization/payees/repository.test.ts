import { beforeEach, describe, expect, it, vi } from 'vitest';
import { payeeMemorySchema } from './schema';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => ({ execute: mocks.execute }), schema: await import('@/lib/db/schema') }));
import { payeeMemoryRepo } from './repository';

beforeEach(() => vi.resetAllMocks());

describe('private memory DTOs across database timestamp drivers', () => {
  it('normalises raw Neon timestamps before acknowledging or rendering saved private meaning', async () => {
    mocks.execute.mockResolvedValue({ rows: [{
      id: '6344f29f-8726-4b08-8cd8-4c10be613c56', revision: 1, status: 'active', account_id: 11, account_name: 'Home bank',
      account_type: 'ASSET', owner_id: 1, direction: -1, currency: 'GBP', property_id: null,
      payee_name: 'Avery', purpose: 'Household cleaner', category_id: 1, category_name: 'Cleaning', identity_kind: 'bank_payee',
      aliases: ['Avery'], source_journal_id: 1, created_at: '2026-10-24 19:30:12.123456+01', updated_at: '2026-10-24 18:31:13+00',
    }] });
    const memory = await payeeMemoryRepo.get('6344f29f-8726-4b08-8cd8-4c10be613c56');
    expect(memory).toMatchObject({ createdAt: '2026-10-24T18:30:12.123Z', updatedAt: '2026-10-24T18:31:13.000Z' });
    expect(payeeMemorySchema.safeParse(memory).success).toBe(true);
  });
});
