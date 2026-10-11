import { describe, expect, it } from 'vitest';
import { exampleJson, type Json } from './test-fixtures';
import { isRealIsoDate, itemReference, money2, parsePlan, PlanValidationError } from './schema';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** Parse and return the issue messages (or [] if valid). */
function issuesFor(json: unknown): string[] {
  try {
    parsePlan(json);
    return [];
  } catch (err) {
    if (err instanceof PlanValidationError) return err.issues;
    throw err;
  }
}


describe('data plan schema', () => {
  it('accepts the made-up example plan and applies defaults', () => {
    const plan = parsePlan(exampleJson());
    expect(plan.planId).toBe('example-2025-26-v1');
    expect(plan.dedupe.windowDays).toBe(5);
    expect(plan.properties).toHaveLength(2);
    // defaults for sections that were left out
    expect(plan.properties[0].income).toEqual([]);
    expect(plan.properties[1].tenancies).toEqual([]);
    // tagExisting defaults to false when not given
    expect(plan.properties[0].expenses[1].tagExisting).toBe(false);
  });

  it('builds the reference stamped on created journals', () => {
    expect(itemReference('p-1', 'item-2')).toBe('plan:p-1:item-2');
  });

  it('rejects unknown keys instead of silently ignoring them', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].expenses[0].tagExistng = true; // typo
    expect(issuesFor(json).join('\n')).toMatch(/tagExistng|Unrecognized/i);
  });

  it('requires note, confidence and include on every item', () => {
    for (const key of ['note', 'confidence', 'include']) {
      const json = clone(exampleJson()) as Json;
      delete json.properties[0].expenses[0][key];
      expect(issuesFor(json).length, `missing ${key}`).toBeGreaterThan(0);
    }
    const json = clone(exampleJson()) as Json;
    json.properties[0].expenses[0].note = '   ';
    expect(issuesFor(json).join('\n')).toMatch(/note is required/);
  });

  it('rejects duplicate item ids across the whole plan', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[1].income[0].id = 'example-insurance';
    expect(issuesFor(json).join('\n')).toMatch(/duplicate item id 'example-insurance'/);
  });

  it('rejects an account alias that is not defined', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].expenses[0].paidFrom = 'nowhere';
    expect(issuesFor(json).join('\n')).toMatch(/account alias 'nowhere' is not defined/);
  });

  it('rejects included journal items outside the tax year but allows excluded ones', () => {
    const outside = clone(exampleJson()) as Json;
    outside.properties[0].expenses[0].date = '2026-04-06';
    expect(issuesFor(outside).join('\n')).toMatch(/outside tax year 2025-26/);

    const excluded = clone(exampleJson()) as Json;
    excluded.properties[0].expenses[0].date = '2026-04-06';
    excluded.properties[0].expenses[0].include = false;
    expect(issuesFor(excluded)).toEqual([]);
  });

  it('needs an amount when an item is included, but not for a placeholder', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].expenses[1].include = true; // the boiler service has amount null
    expect(issuesFor(json).join('\n')).toMatch(/amount is required when include is true/);
  });

  it('validates money strings', () => {
    for (const bad of ['12.345', '-5', '1,000.00', 'abc', '0', '0.00', '']) {
      const json = clone(exampleJson()) as Json;
      json.properties[0].expenses[0].amount = bad;
      expect(issuesFor(json).length, `amount ${bad}`).toBeGreaterThan(0);
    }
    const ok = clone(exampleJson()) as Json;
    ok.properties[0].expenses[0].amount = '1234';
    expect(issuesFor(ok)).toEqual([]);
    expect(money2('1234')).toBe('1234.00');
  });

  it('checks calendar dates', () => {
    expect(isRealIsoDate('2026-02-28')).toBe(true);
    expect(isRealIsoDate('2026-02-30')).toBe(false);
    expect(isRealIsoDate('2026-2-3')).toBe(false);
    expect(isRealIsoDate('26-02-03')).toBe(false);
  });

  it('rejects a malformed tax year label', () => {
    const json = clone(exampleJson()) as Json;
    json.taxYear = '2025-27';
    expect(issuesFor(json).join('\n')).toMatch(/tax-year label/);
  });

  it('rejects ids that would corrupt the reference', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].expenses[0].id = 'has:colon';
    expect(issuesFor(json).join('\n')).toMatch(/lower-case letters, digits and hyphens/);
    const plan = clone(exampleJson()) as Json;
    plan.planId = 'Has Space';
    expect(issuesFor(plan).join('\n')).toMatch(/lower-case letters, digits and hyphens/);
  });

  it('requires startDate, tenantName and rentAmount for an included tenancy', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].tenancies[1].include = true; // the placeholder
    const text = issuesFor(json).join('\n');
    expect(text).toMatch(/startDate is required/);
    expect(text).toMatch(/rentAmount is required/);
  });

  it('flags a tenancy that ends before it starts', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].tenancies[0].fields.endDate.value = '2024-01-01';
    expect(issuesFor(json).join('\n')).toMatch(/endDate is before startDate/);
  });

  it('refuses tax profile fields listed twice', () => {
    const json = clone(exampleJson()) as Json;
    json.ownerTaxProfile.items[1].field = 'employmentIncome';
    expect(issuesFor(json).join('\n')).toMatch(/listed twice/);
  });

  it('reports every problem at once', () => {
    const json = clone(exampleJson()) as Json;
    json.taxYear = 'nope';
    json.properties[0].expenses[0].amount = 'x';
    json.properties[0].expenses[0].paidFrom = 'ghost';
    expect(issuesFor(json).length).toBeGreaterThanOrEqual(2);
  });
});

describe('mortgage interest items', () => {
  it('take their description from the lender, so a description key is rejected', () => {
    const json = clone(exampleJson()) as Json;
    json.properties[0].mortgageInterest[0].description = 'my own words';
    expect(issuesFor(json).join('\n')).toMatch(/description|Unrecognized/i);
  });
});
