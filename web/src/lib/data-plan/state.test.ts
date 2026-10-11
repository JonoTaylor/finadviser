import { describe, expect, it } from 'vitest';
import { REQUIRED_SCHEMA, assembleState, buildStateQueries, evaluateSchema, schemaColumnsQuery, schemaReady, type StateQueryKey } from './state';
import { basePlan } from './test-fixtures';

/** information_schema rows for a fully migrated database. */
function fullSchemaRows(): Array<{ table_name: string; column_name: string }> {
  return Object.entries(REQUIRED_SCHEMA).flatMap(([table_name, columns]) => columns.map(column_name => ({ table_name, column_name })));
}

describe('evaluateSchema', () => {
  it('a migrated database is ready', () => {
    const r = evaluateSchema(fullSchemaRows());
    expect(r).toEqual({ blocking: [], pendingMigration: [], lettingType: true, taxProfiles: true });
    expect(schemaReady(r)).toBe(true);
  });

  it('a database without letting_type or owner_tax_profiles is "pending migration", not broken', () => {
    const rows = fullSchemaRows().filter(r => r.table_name !== 'owner_tax_profiles' && !(r.table_name === 'properties' && r.column_name === 'letting_type'));
    const r = evaluateSchema(rows);
    expect(r.blocking).toEqual([]);
    expect(r.pendingMigration).toEqual(['properties is missing column letting_type', 'table owner_tax_profiles is missing']);
    expect(r).toMatchObject({ lettingType: false, taxProfiles: false });
    expect(schemaReady(r)).toBe(false);
  });

  it('each piece is reported on its own', () => {
    const noLetting = evaluateSchema(fullSchemaRows().filter(r => !(r.table_name === 'properties' && r.column_name === 'letting_type')));
    expect(noLetting).toMatchObject({ lettingType: false, taxProfiles: true, pendingMigration: ['properties is missing column letting_type'] });
    const noProfiles = evaluateSchema(fullSchemaRows().filter(r => r.table_name !== 'owner_tax_profiles'));
    expect(noProfiles).toMatchObject({ lettingType: true, taxProfiles: false, pendingMigration: ['table owner_tax_profiles is missing'] });
  });

  it('a profile table that lacks a column counts as pending too (the loader cannot use it)', () => {
    const r = evaluateSchema(fullSchemaRows().filter(x => !(x.table_name === 'owner_tax_profiles' && x.column_name === 'dividends')));
    expect(r.taxProfiles).toBe(false);
    expect(r.pendingMigration).toEqual(['owner_tax_profiles is missing column dividends']);
    expect(r.blocking).toEqual([]);
  });

  it('missing tables the migration does not create are blocking', () => {
    const r = evaluateSchema(fullSchemaRows().filter(x => x.table_name !== 'journal_entries' && !(x.table_name === 'tenancies' && x.column_name === 'notes')));
    expect(r.blocking).toEqual(['tenancies is missing column notes', 'table journal_entries is missing']);
    expect(r.pendingMigration).toEqual([]);
    expect(schemaReady(r)).toBe(false);
  });

  it('a missing properties table is blocking and is not also reported as a pending letting_type', () => {
    const r = evaluateSchema(fullSchemaRows().filter(x => x.table_name !== 'properties'));
    expect(r.blocking).toEqual(['table properties is missing']);
    expect(r.pendingMigration).toEqual([]);
    expect(r.lettingType).toBe(false);
  });

  it('asks for every table and column the loader needs, with bound parameters', () => {
    const q = schemaColumnsQuery();
    expect(q.params).toEqual(Object.keys(REQUIRED_SCHEMA));
    expect(q.text).not.toContain('journal_entries');
    expect(q.text).toContain('$11');
  });
});

describe('buildStateQueries', () => {
  const plan = basePlan();
  const migrated = { lettingType: true, taxProfiles: true };

  it('builds fixed, independent queries: nothing needs another query\'s result', () => {
    const queries = buildStateQueries(plan, migrated);
    expect(queries.map(q => q.key)).toEqual([
      'owners', 'properties', 'ownership', 'allocationRules', 'accounts', 'categories',
      'tenancies', 'mortgages', 'taggedLines', 'candidateLines', 'referencedJournals', 'taxProfile',
    ] satisfies StateQueryKey[]);
    // the properties of interest are found by sub-select, never by a list of ids from an earlier query
    for (const key of ['tenancies', 'mortgages', 'taggedLines', 'candidateLines'] as const) {
      const q = queries.find(x => x.key === key)!;
      expect(q.text, key).toContain('SELECT p.id FROM properties p WHERE p.name = ANY($1::text[])');
      expect(q.params.slice(0, 2), key).toEqual([['1 Example Road', '2 Sample Street'], 'Alex Example']);
    }
  });

  it('binds every value: placeholders are 1..n and each parameter is used', () => {
    for (const q of buildStateQueries(plan, migrated)) {
      const used = [...new Set([...q.text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])))].sort((a, b) => a - b);
      expect(used, q.key).toEqual(q.params.map((_, i) => i + 1));
    }
  });

  it('only reads: every query is a SELECT', () => {
    for (const q of buildStateQueries(plan, migrated)) {
      expect(q.text.trim(), q.key).toMatch(/^SELECT\b/);
      expect(q.text, q.key).not.toMatch(/\b(INSERT|UPDATE|DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/i);
    }
  });

  it('looks for candidate duplicates only when the plan has journal items, within the dedupe window', () => {
    const candidate = buildStateQueries(plan, migrated).find(q => q.key === 'candidateLines')!;
    expect(candidate.params[2]).toBe('2025-05-26'); // earliest item date minus the 5-day window
    expect(candidate.params[3]).toBe('2025-08-15');
    expect(candidate.params.slice(4)).toEqual(expect.arrayContaining(['300.00', '400.00', '250.00', '240.00']));
    const empty = basePlan(j => {
      for (const s of j.properties as Array<Record<string, unknown>>) {
        s.income = [];
        s.expenses = [];
        s.mortgageInterest = [];
      }
    });
    expect(buildStateQueries(empty, migrated).some(q => q.key === 'candidateLines')).toBe(false);
  });

  it('leaves out what the schema does not have yet', () => {
    const queries = buildStateQueries(plan, { lettingType: false, taxProfiles: false });
    expect(queries.find(q => q.key === 'properties')!.text).not.toContain('letting_type');
    expect(queries.some(q => q.key === 'taxProfile')).toBe(false);
    expect(buildStateQueries(plan, migrated).find(q => q.key === 'properties')!.text).toContain('letting_type');
  });
});

describe('assembleState', () => {
  const plan = basePlan();
  const rows = (): Partial<Record<StateQueryKey, Record<string, unknown>[]>> => ({
    owners: [{ id: 1, name: 'Alex Example' }],
    properties: [
      { id: 10, name: '1 Example Road', letting_type: 'standard' },
      { id: 20, name: '2 Sample Street', letting_type: 'rent_a_room' },
    ],
    tenancies: [{ id: '3', property_id: 10, tenant_name: 'Pat', start_date: '2024-09-01', end_date: null, rent_amount: '1000.00', rent_frequency: 'monthly', deposit_amount: null, notes: null }],
    taxProfile: [{ employment_income: '25000.00', paye_tax_paid: '0.00', self_employment_income: '0.00', savings_interest: '0.00', dividends: '0.00', other_income: '0.00', property_losses_brought_forward: '0.00', finance_costs_brought_forward: '0.00', notes: null }],
  });

  it('maps rows, converting ids to numbers and keeping money as text', () => {
    const state = assembleState(plan, { lettingType: true, taxProfiles: true }, rows());
    expect(state.properties.map(p => [p.id, p.lettingType])).toEqual([[10, 'standard'], [20, 'rent_a_room']]);
    expect(state.tenancies[0]).toMatchObject({ id: 3, propertyId: 10, rentAmount: '1000.00', endDate: null });
    expect(state.taxProfile).toMatchObject({ ownerId: 1, taxYear: '2025-26', notes: null });
    expect(state.taxProfile!.values.employmentIncome).toBe('25000.00');
    expect(state.pendingMigration).toBeUndefined();
    expect(state.taggedLines).toEqual([]);
  });

  it('flags what is pending, and treats every property as standard when the column is missing', () => {
    const r = rows();
    r.properties = [{ id: 10, name: '1 Example Road' }, { id: 20, name: '2 Sample Street' }];
    delete r.taxProfile;
    const state = assembleState(plan, { lettingType: false, taxProfiles: false }, r);
    expect(state.pendingMigration).toEqual({ lettingType: true, taxProfile: true });
    expect(state.properties.every(p => p.lettingType === 'standard')).toBe(true);
    expect(state.taxProfile).toBeNull();
    expect(assembleState(plan, { lettingType: true, taxProfiles: false }, rows()).pendingMigration).toEqual({ lettingType: false, taxProfile: true });
  });

  it('has no tax profile when the owner has no row for the year', () => {
    const r = rows();
    r.taxProfile = [];
    expect(assembleState(plan, { lettingType: true, taxProfiles: true }, r).taxProfile).toBeNull();
  });
});
