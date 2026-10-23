import { describe, expect, it } from 'vitest';
import { planChanges } from './planner';
import { applyChange, orderForApply, type Queryable } from './statements';
import { baseState, basePlan, ROAD_ID } from './test-fixtures';
import type { Change } from './types';

interface Call {
  text: string;
  params: unknown[];
}

/** Records every statement; answers INSERT/UPDATE ... RETURNING with one row. */
function recorder(rowsPerCall = 1): { q: Queryable; calls: Call[] } {
  const calls: Call[] = [];
  const q: Queryable = {
    async query<R extends object>(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      return { rows: Array.from({ length: rowsPerCall }, () => ({ id: 42 }) as unknown as R), rowCount: rowsPerCall };
    },
  };
  return { q, calls };
}

const allChanges = (): Change[] => {
  const state = baseState();
  state.tenancies = [
    { id: 3, propertyId: ROAD_ID, tenantName: 'P', startDate: '2024-09-01', endDate: null, rentAmount: '1000.00', rentFrequency: 'monthly', depositAmount: null, notes: null },
  ];
  const create = planChanges(basePlan(), baseState()).changes;
  const update = planChanges(basePlan(), state).changes.filter(c => c.type === 'tenancy_update');
  state.candidateLines = [
    { bookEntryId: 1, journalId: 77, date: '2025-07-02', description: 'x', reference: null, categoryId: null, propertyId: null, isTransfer: false, accountId: 104, accountName: 'Uncategorized Expense', accountType: 'EXPENSE', accountIsSystem: true, amount: '300.00' },
  ];
  const tag = planChanges(basePlan(), state).changes.filter(c => c.type === 'journal_tag');
  return [...create, ...update, ...tag];
};

describe('applyChange SQL', () => {
  it('covers every change type', () => {
    const types = new Set(allChanges().map(c => c.type));
    expect([...types].sort()).toEqual(['journal_create', 'journal_tag', 'letting_type', 'tax_profile', 'tenancy_create', 'tenancy_update']);
  });

  it('never issues DELETE, TRUNCATE, DROP or ALTER', async () => {
    const { q, calls } = recorder();
    for (const c of allChanges()) await applyChange(q, c);
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) {
      expect(call.text).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/i);
      expect(call.text).toMatch(/^\s*(INSERT|UPDATE)\b/i);
    }
  });

  it('binds every value as a parameter and uses explicit casts', async () => {
    const { q, calls } = recorder();
    for (const c of allChanges()) await applyChange(q, c);
    for (const call of calls) {
      const placeholders = new Set([...call.text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));
      expect(Math.max(...placeholders), call.text).toBe(call.params.length);
      expect(placeholders.size, call.text).toBe(call.params.length);
      // no literal values smuggled into the SQL text
      expect(call.text).not.toMatch(/Example|Pat Tenant|plan:/);
    }
  });

  it('inserts a journal guarded by its reference, then its two balanced legs', async () => {
    const { q, calls } = recorder();
    const c = allChanges().find(x => x.type === 'journal_create' && x.itemId === 'example-insurance')!;
    await applyChange(q, c);
    expect(calls).toHaveLength(3);
    expect(calls[0].text).toContain('WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference = $3::text)');
    expect(calls[0].params).toEqual(['2025-07-02', 'Landlord insurance 1 Example Road', 'plan:example-2025-26-v1:example-insurance', 2, ROAD_ID]);
    expect(calls[1].params).toEqual([42, 100, '-300.00']);
    expect(calls[2].params).toEqual([42, 103, '300.00']);
  });

  it('fails (so the transaction rolls back) when a guarded insert changes nothing', async () => {
    const { q } = recorder(0);
    const c = allChanges().find(x => x.type === 'journal_create')!;
    await expect(applyChange(q, c)).rejects.toThrow(/expected exactly one row/);
  });

  it('only updates an untagged journal when tagging', async () => {
    const { q, calls } = recorder();
    const c = allChanges().find(x => x.type === 'journal_tag')!;
    await applyChange(q, c);
    expect(calls[0].text).toContain('property_id IS NULL');
    expect(calls[0].text).toContain('COALESCE(category_id');
  });

  it('upserts the tax profile touching only the planned columns', async () => {
    const { q, calls } = recorder();
    const c = allChanges().find(x => x.type === 'tax_profile')!;
    await applyChange(q, c);
    const text = calls[0].text;
    expect(text).toContain('ON CONFLICT (owner_id, tax_year) DO NOTHING');
    expect(text).toContain('known_fields, field_sources, revision');
    expect(c).toHaveProperty('expectedRevision', 0);
    expect(text).toContain('employment_income');
    expect(text).not.toContain('dividends');
    expect(text).toContain("'source', 'user'");
  });

  it('updates a tenancy by id AND property AND start date, only the planned columns', async () => {
    const { q, calls } = recorder();
    const c = allChanges().find(x => x.type === 'tenancy_update')!;
    await applyChange(q, c);
    expect(calls[0].text).toMatch(/SET end_date = \$1::text\s+WHERE id = \$2::integer AND property_id = \$3::integer AND start_date = \$4::text/);
    expect(calls[0].params).toEqual(['2026-03-01', 3, ROAD_ID, '2024-09-01']);
  });
});

describe('orderForApply', () => {
  it('applies property settings and tenancies before journals, and the profile last', () => {
    const order = orderForApply(planChanges(basePlan(), baseState()).changes).map(c => c.type);
    expect(order[0]).toBe('letting_type');
    expect(order[order.length - 1]).toBe('tax_profile');
    expect(order.indexOf('tenancy_create')).toBeLessThan(order.indexOf('journal_create'));
  });

  it('is deterministic whatever order the changes arrive in', () => {
    const changes = planChanges(basePlan(), baseState()).changes;
    const a = orderForApply(changes).map(c => JSON.stringify(c));
    const b = orderForApply([...changes].reverse()).map(c => JSON.stringify(c));
    expect(b).toEqual(a);
  });
});
