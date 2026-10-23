import { describe, expect, it } from 'vitest';
import { changeDigest, renderChange, renderPlanResult, renderSchemaNotice, renderSnapshot, renderTotalsComparison } from './format';
import { formatGbp, formatGbpDelta } from './money';
import { planChanges } from './planner';
import { simulateChanges } from './simulate';
import { computeOwnerTotals } from './totals';
import { baseState, basePlan, OWNER_ID } from './test-fixtures';

describe('money formatting', () => {
  it('formats pounds with grouping and sign', () => {
    expect(formatGbp('1234.5')).toBe('£1,234.50');
    expect(formatGbp('-0.5')).toBe('-£0.50');
    expect(formatGbp('0')).toBe('£0.00');
    expect(formatGbp('1000000')).toBe('£1,000,000.00');
    expect(formatGbpDelta('10', '25.5')).toBe('+£15.50');
    expect(formatGbpDelta('25.5', '10')).toBe('-£15.50');
    expect(formatGbpDelta('1', '1.00')).toBe('£0.00');
  });
});

describe('changeDigest', () => {
  it('is stable and order independent, and changes when a change changes', () => {
    const changes = planChanges(basePlan(), baseState()).changes;
    const digest = changeDigest(changes);
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(changeDigest([...changes].reverse())).toBe(digest);
    const altered = JSON.parse(JSON.stringify(changes));
    altered.find((c: { type: string }) => c.type === 'journal_create').amount = '301.00';
    expect(changeDigest(altered)).not.toBe(digest);
  });
  it('requires a new review digest when the profile revision changes without a monetary change', () => {
    const changes = planChanges(basePlan(), baseState()).changes;
    const profile = changes.find(c => c.type === 'tax_profile')!;
    const updated = changes.map(c => c === profile ? { ...c, expectedRevision: 9 } : c);
    expect(changeDigest(updated)).not.toBe(changeDigest(changes));
  });
});

describe('rendering', () => {
  const state = baseState();
  const plan = basePlan();
  const result = planChanges(plan, state);

  it('describes each change with the sign convention spelled out', () => {
    const text = result.changes.map(renderChange).join('\n');
    expect(text).toContain('Cr Example Current Account £300.00  /  Dr Property Expenses £300.00');
    expect(text).toContain('Dr Example Current Account £250.00  /  Cr Uncategorized Income £250.00');
    expect(text).toContain('reference plan:example-2025-26-v1:example-insurance');
    expect(text).toContain("'standard' -> 'rent_a_room'");
  });

  it('lists skipped items with their reasons', () => {
    const text = renderPlanResult(result);
    expect(text).toContain('Excluded (include: false), listed only');
    expect(text).toContain('example-boiler-service');
  });

  it('prints before/after totals with the change', () => {
    const before = computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state });
    const after = computeOwnerTotals({ ownerId: OWNER_ID, taxYear: '2025-26', state: simulateChanges(state, result.changes) });
    const text = renderTotalsComparison(before, after);
    expect(text).toContain('Gross income');
    expect(text).toContain('Mortgage interest');
    expect(text).toContain('+£200.00');
  });

  it('snapshot shows owners, properties, accounts the plan would use and unresolved aliases', () => {
    const open = basePlan(j => ((j.accounts as Record<string, unknown>).ownerBank = null));
    const text = renderSnapshot(open, state);
    expect(text).toContain('== Owners ==');
    expect(text).toContain('letting_type=standard');
    expect(text).toContain('ownerBank -> (not set)');
    expect(text).toContain('ASSET accounts that exist: "Example Current Account"');
    expect(text).toContain('"Property insurance": #2 (under Property expenses)');
  });
});

describe('schema not migrated yet', () => {
  const pendingState = () => {
    const s = baseState();
    s.pendingMigration = { lettingType: true, taxProfile: true };
    return s;
  };

  it('the notice names what is missing and what it means', () => {
    const text = renderSchemaNotice({ pendingMigration: ['properties is missing column letting_type', 'table owner_tax_profiles is missing'] });
    expect(text).toContain('== Schema not migrated yet ==');
    expect(text).toContain('- properties is missing column letting_type');
    expect(text).toContain('pending migration: would apply after `npm run db:migrate` or the next deploy');
    expect(text).toContain('--apply refuses until the schema is migrated');
    expect(renderSchemaNotice({ pendingMigration: [] })).toBe('');
  });

  it('pending items are listed under their own heading with the explanation', () => {
    const text = renderPlanResult(planChanges(basePlan(), pendingState()));
    expect(text).toContain('Pending migration (the schema is not migrated yet) (3)');
    expect(text).toContain('[=] sample-letting-type');
    expect(text).toContain('pending migration: would apply after `npm run db:migrate` or the next deploy');
    // listed before the plain "Excluded" group
    expect(text.indexOf('Pending migration')).toBeLessThan(text.indexOf('Excluded (include: false)'));
  });

  it('the snapshot does not pretend to know the letting type or the profile', () => {
    const text = renderSnapshot(basePlan(), pendingState());
    expect(text).toContain('letting_type=(not migrated yet)');
    expect(text).not.toContain('letting_type=standard');
    expect(text).toContain('table owner_tax_profiles does not exist yet');
  });

  it('the digest only covers the changes that are planned', () => {
    const migrated = planChanges(basePlan(), baseState()).changes;
    const pending = planChanges(basePlan(), pendingState()).changes;
    expect(pending.length).toBe(migrated.length - 2);
    expect(changeDigest(pending)).not.toBe(changeDigest(migrated));
  });
});
