import { describe, expect, it } from 'vitest';
import {
  buildWriteBatch,
  classifyWriteFailure,
  guardedWrite,
  LOADER_LOCK_KEY,
  lockStatement,
  noteSql,
  ParamList,
  raceCheckStatement,
  raceDetail,
  RACE_CHECK_MARKER,
  setupStatement,
  type BatchStatement,
} from './http-statements';
import { planChanges } from './planner';
import { baseState, basePlan, ROAD_ID, STREET_ID } from './test-fixtures';
import type { Change, TaxProfileRow } from './types';

const existingTenancy = {
  id: 3,
  propertyId: ROAD_ID,
  tenantName: 'Pat Tenant',
  startDate: '2024-09-01',
  endDate: null,
  rentAmount: '1000.00',
  rentFrequency: 'monthly' as const,
  depositAmount: '1000.00',
  notes: 'Example tenancy agreement ref 123.',
};

/** A change set covering every change type. */
function allChanges(): Change[] {
  const create = planChanges(basePlan(), baseState()).changes;
  const withTenancy = baseState();
  withTenancy.tenancies = [{ ...existingTenancy }];
  const update = planChanges(basePlan(), withTenancy).changes.filter(c => c.type === 'tenancy_update');
  const withUntagged = baseState();
  withUntagged.candidateLines = [
    { bookEntryId: 1, journalId: 77, date: '2025-07-02', description: 'x', reference: null, categoryId: null, propertyId: null, isTransfer: false, accountId: 104, accountName: 'Uncategorized Expense', accountType: 'EXPENSE', accountIsSystem: true, amount: '300.00' },
  ];
  const tag = planChanges(basePlan(), withUntagged).changes.filter(c => c.type === 'journal_tag');
  return [...create, ...update, ...tag];
}

const findChange = <T extends Change['type']>(changes: Change[], type: T, itemId?: string) =>
  changes.find(c => c.type === type && (itemId === undefined || ('itemId' in c && c.itemId === itemId))) as Extract<Change, { type: T }>;

const writeFor = (change: Change): BatchStatement => guardedWrite(change)!;
const placeholderSet = (text: string) => new Set([...text.matchAll(/\$(\d+)/g)].map(m => Number(m[1])));

describe('batch assembly', () => {
  const changes = allChanges();
  const batch = buildWriteBatch(changes);

  it('is lock, setup, one guarded write per change, race check', () => {
    expect(batch.statements.map(s => s.kind)).toEqual(['lock', 'setup', ...changes.map(() => 'write'), 'check']);
    expect(batch.writeCount).toBe(changes.length);
    expect(new Set(batch.statements.filter(s => s.change).map(s => s.change)).size).toBe(changes.length);
  });

  it('takes the loader advisory lock, with the same key as the interactive path, as the first statement', () => {
    const first = batch.statements[0];
    expect(first.text).toContain('pg_try_advisory_xact_lock($1::bigint)');
    expect(first.params).toEqual([727401]);
    expect(LOADER_LOCK_KEY).toBe(727401);
    expect(buildWriteBatch(changes, { lockKey: 5 }).statements[0].params).toEqual([5]);
  });

  it('ends with the race check, which is told the total the writes are expected to touch', () => {
    const last = batch.statements[batch.statements.length - 1];
    expect(last.kind).toBe('check');
    expect(last.params).toEqual([batch.expectedTouched]);
    // 1 per update/insert-only change, 1 + legs for a journal
    const expected = changes.reduce((n, c) => n + (c.type === 'journal_create' ? 1 + c.legs.length : 1), 0);
    expect(batch.expectedTouched).toBe(expected);
    expect(batch.statements.filter(s => s.kind === 'write').reduce((n, s) => n + s.expected, 0)).toBe(expected);
  });

  it('is deterministic whatever order the changes arrive in', () => {
    // (a real plan: one change per item. allChanges() mixes a create and an update of the same item, which a plan never does.)
    const real = planChanges(basePlan(), baseState()).changes;
    const a = buildWriteBatch(real).statements.map(s => s.text + JSON.stringify(s.params));
    const b = buildWriteBatch([...real].reverse()).statements.map(s => s.text + JSON.stringify(s.params));
    expect(b).toEqual(a);
  });

  it('applies letting types and tenancies before journals, and the profile last', () => {
    const order = batch.statements.filter(s => s.change).map(s => s.change!.type);
    expect(order[0]).toBe('letting_type');
    expect(order[order.length - 1]).toBe('tax_profile');
    expect(order.indexOf('tenancy_update')).toBeLessThan(order.indexOf('journal_create'));
  });

  it('covers every change type', () => {
    expect([...new Set(changes.map(c => c.type))].sort()).toEqual(['journal_create', 'journal_tag', 'letting_type', 'tax_profile', 'tenancy_create', 'tenancy_update']);
  });

  it('copes with an empty change set (lock, setup, a check that expects nothing)', () => {
    const empty = buildWriteBatch([]);
    expect(empty.statements.map(s => s.kind)).toEqual(['lock', 'setup', 'check']);
    expect(empty.expectedTouched).toBe(0);
  });

  it('reports a request size that grows with the batch', () => {
    expect(batch.approxBytes).toBeGreaterThan(buildWriteBatch([]).approxBytes);
  });
});

describe('every statement', () => {
  const all = [...buildWriteBatch(allChanges()).statements, ...buildWriteBatch(planChanges(basePlan(), baseState()).changes).statements];

  it('never issues DELETE, TRUNCATE, DROP, ALTER or GRANT', () => {
    expect(all.length).toBeGreaterThan(10);
    for (const s of all) expect(s.text, s.label).not.toMatch(/\b(DELETE|TRUNCATE|DROP|ALTER|GRANT)\b/i);
  });

  it('is a single SELECT or a WITH ... statement, never several statements', () => {
    for (const s of all) {
      expect(s.text, s.label).toMatch(/^(SELECT|WITH)\b/);
      // (the ';' inside a string literal is fine)
      expect(s.text.replace(/'[^']*'/g, "''"), s.label).not.toContain(';');
    }
  });

  it('binds every value as a parameter: placeholders are 1..n, each parameter is used', () => {
    for (const s of all) {
      const used = placeholderSet(s.text);
      expect([...used].sort((a, b) => a - b), s.label).toEqual(s.params.map((_, i) => i + 1));
      // no literal plan data in the SQL text
      expect(s.text, s.label).not.toMatch(/Example|Pat Tenant|plan:|Landlord/);
    }
  });

  it('casts every parameter explicitly', () => {
    for (const s of all) {
      for (const m of s.text.matchAll(/\$\d+(?!\d)/g)) {
        expect(s.text.slice(m.index!, m.index! + m[0].length + 2), `${s.label} ${m[0]}`).toMatch(/^\$\d+::/);
      }
    }
  });

  it('writes end by adding what they touched to the running total, transaction-locally', () => {
    for (const s of all.filter(x => x.kind === 'write')) {
      expect(s.text, s.label).toContain("set_config('dataplan.touched'");
      expect(s.text, s.label).toContain("set_config('dataplan.shortfalls'");
      expect(s.text.match(/set_config\([^)]*,\s*true\)/g)?.length, s.label).toBe(2);
      expect(s.params.slice(-2), s.label).toEqual([s.expected, s.label]);
    }
  });
});

describe('write guards', () => {
  const changes = allChanges();

  it('journal: ONE statement; the journal is skipped unless its reference is free, and its legs come from the journal it inserted', () => {
    const c = findChange(changes, 'journal_create', 'example-insurance');
    const s = writeFor(c);
    expect(s.text).toMatch(/^WITH j AS \(\s*INSERT INTO journal_entries/);
    expect(s.text).toContain('WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference = $3::text)');
    expect(s.text).toMatch(/b AS \(\s*INSERT INTO book_entries \(journal_entry_id, account_id, amount\)\s*SELECT j\.id, v\.account_id, v\.amount\s*FROM j CROSS JOIN \(VALUES \(\$6::integer, \$7::numeric\), \(\$8::integer, \$9::numeric\)\) AS v\(account_id, amount\)/);
    expect(s.params.slice(0, 9)).toEqual(['2025-07-02', 'Landlord insurance 1 Example Road', 'plan:example-2025-26-v1:example-insurance', 2, ROAD_ID, 100, '-300.00', 103, '300.00']);
    expect(s.expected).toBe(3);
    expect(s.text).toContain('(SELECT count(*) FROM j)::integer + (SELECT count(*) FROM b)::integer');
    // the legs never name a journal id of their own
    expect(s.text.match(/INSERT INTO book_entries/g)).toHaveLength(1);
    expect(s.text).not.toMatch(/journal_entry_id\s*=\s*\$/);
  });

  it('tenancy create: only if no tenancy starts that day at that property', () => {
    const c = findChange(planChanges(basePlan(), baseState()).changes, 'tenancy_create');
    const s = writeFor(c);
    expect(s.text).toContain('WHERE NOT EXISTS (SELECT 1 FROM tenancies WHERE property_id = $1::integer AND start_date = $3::text)');
    expect(s.expected).toBe(1);
  });

  it('tenancy update: only where every overwritten column still holds the text the plan was based on', () => {
    const c = findChange(changes, 'tenancy_update');
    expect(c.before).toEqual({ endDate: null });
    const s = writeFor(c);
    expect(s.text).toMatch(/SET end_date = \$1::text\s+WHERE id = \$2::integer AND property_id = \$3::integer AND start_date = \$4::text\s+AND tenancies\.end_date::text IS NOT DISTINCT FROM \$5::text/);
    expect(s.params.slice(0, 5)).toEqual(['2026-03-01', 3, ROAD_ID, '2024-09-01', null]);
  });

  it('tenancy update with several fields guards each of them with its own before-value', () => {
    const base = findChange(changes, 'tenancy_update');
    const c: Change = { ...base, set: { endDate: '2026-03-01', rentAmount: '1100.00', notes: null }, before: { endDate: '2026-02-01', rentAmount: '1000.00', notes: 'old' } };
    const s = writeFor(c);
    expect(s.text).toContain('end_date = $1::text, rent_amount = $2::numeric, notes = $3::text');
    expect(s.text).toContain('tenancies.end_date::text IS NOT DISTINCT FROM $7::text');
    expect(s.text).toContain('tenancies.rent_amount::text IS NOT DISTINCT FROM $8::text');
    expect(s.text).toContain('tenancies.notes::text IS NOT DISTINCT FROM $9::text');
    expect(s.params.slice(0, 9)).toEqual(['2026-03-01', '1100.00', null, 3, ROAD_ID, '2024-09-01', '2026-02-01', '1000.00', 'old']);
  });

  it('a tenancy update with nothing to set writes nothing', () => {
    const base = findChange(changes, 'tenancy_update');
    expect(guardedWrite({ ...base, set: {}, before: {} })).toBeNull();
    expect(buildWriteBatch([{ ...base, set: {}, before: {} }]).writeCount).toBe(0);
  });

  it('letting type: only where the property still has the value the plan saw', () => {
    const s = writeFor(findChange(changes, 'letting_type'));
    expect(s.text).toMatch(/UPDATE properties SET letting_type = \$1::text\s+WHERE id = \$2::integer AND letting_type = \$3::text/);
    expect(s.params.slice(0, 3)).toEqual(['rent_a_room', STREET_ID, 'standard']);
  });

  it('tagging: only an untagged, non-transfer journal that still has the date and amount the plan matched', () => {
    const s = writeFor(findChange(changes, 'journal_tag'));
    expect(s.text).toContain('property_id IS NULL');
    expect(s.text).toContain('journal_entries.date = $4::text');
    expect(s.text).toContain('COALESCE(is_transfer, FALSE) = FALSE');
    expect(s.text).toContain("a.account_type IN ('INCOME', 'EXPENSE')");
    expect(s.text).toContain('ABS(be.amount::numeric) = $5::numeric');
    expect(s.text).toContain('COALESCE(category_id, $2::integer)');
    expect(s.params.slice(0, 5)).toEqual([ROAD_ID, 2, 77, '2025-07-02', '300.00']);
  });

  describe('tax profile', () => {
    it('with no row at read time: a row appearing since is a lost race, never overwritten', () => {
      const c = findChange(changes, 'tax_profile');
      expect(c.existed).toBe(false);
      const s = writeFor(c);
      expect(s.text).toContain('ON CONFLICT (owner_id, tax_year) DO NOTHING');
      expect(s.text).not.toContain('DO UPDATE');
      expect(s.params[0]).toBe(1);
      expect(s.params[2]).toBe('30000.00');
    });

    it('with a row at read time: updates only the planned columns, and only if they still hold what the plan saw', () => {
      const state = baseState();
      const row: TaxProfileRow = {
        ownerId: 1,
        taxYear: '2025-26',
        values: { employmentIncome: '25000.00', payeTaxPaid: '0.00', selfEmploymentIncome: '0.00', savingsInterest: '0.00', dividends: '0.00', otherIncome: '0.00', propertyLossesBroughtForward: '0.00', financeCostsBroughtForward: '0.00' },
        notes: 'My own note.', revision: 1, knownFields: null,
      };
      state.taxProfile = row;
      const c = findChange(planChanges(basePlan(), state).changes, 'tax_profile');
      expect(c.existed).toBe(true);
      const s = writeFor(c);
      expect(s.text).toContain('UPDATE owner_tax_profiles SET employment_income = $3::numeric, notes = $4::text');
      expect(s.text).toContain('AND revision = $5::integer');
      expect(s.text).toContain('revision = owner_tax_profiles.revision + 1');
      expect(s.text).toContain('known_fields =');
      expect(s.text).toContain('field_sources =');
      expect(s.text).not.toContain('dividends =');
      expect(s.params.slice(0, 6)).toEqual([1, '2025-26', '30000.00', c.notes, 1, '["employmentIncome"]']);
    });
  });
});

describe('the race check', () => {
  const check = raceCheckStatement(13);

  it('compares the touched total with the expected total and with an empty shortfall list', () => {
    expect(check.params).toEqual([13]);
    expect(check.text).toContain("current_setting('dataplan.touched', true)");
    expect(check.text).toContain("current_setting('dataplan.shortfalls', true)");
    expect(check.text).toMatch(/WHEN .* = \$1::integer AND .* = '' THEN/);
  });

  it('raises by casting its message to integer, so the message reaches the error text', () => {
    expect(check.text).toMatch(/ELSE \(concat\('data-plan race check failed: expected '/);
    expect(check.text).toMatch(/\)\)::integer\s+END AS touched$/);
    expect(RACE_CHECK_MARKER).toBe('data-plan race check failed');
  });

  it('builds the failing branch from current_setting (STABLE), so the planner cannot fold it at plan time', () => {
    const elseBranch = check.text.slice(check.text.indexOf('ELSE'));
    expect(elseBranch).toContain('current_setting(');
  });

  it('is a plain SELECT: no function to create, no DO block', () => {
    expect(check.text).not.toMatch(/\bDO\b|CREATE|FUNCTION|plpgsql/i);
  });

  it('the lock statement raises (instead of waiting) when the lock is held', () => {
    const lock = lockStatement();
    expect(lock.text).toMatch(/CASE WHEN pg_try_advisory_xact_lock\(\$1::bigint\) THEN 1\s+ELSE \(concat\('data-plan race check failed: another data-plan run holds the loader lock/);
  });

  it('setup resets both counters and sets timeouts transaction-locally', () => {
    const setup = setupStatement();
    expect(setup.text).toContain("set_config('dataplan.touched', '0', true)");
    expect(setup.text).toContain("set_config('dataplan.shortfalls', '', true)");
    expect(setup.text).toContain("set_config('statement_timeout', '120000', true)");
    expect(setup.params).toEqual([]);
  });

  it('noteSql takes the expected count and the label as parameters', () => {
    const p = new ParamList();
    p.add('x');
    const tail = noteSql(p, '(SELECT count(*) FROM w)::integer', 4, 'journal abc');
    expect(p.values).toEqual(['x', 4, 'journal abc']);
    expect(tail).toContain('t.n = $2::integer');
    expect(tail).toContain('$3::text');
    expect(tail).toContain('FROM (SELECT (SELECT count(*) FROM w)::integer AS n) AS t');
  });
});

describe('classifyWriteFailure', () => {
  it('a Postgres verdict (SQLSTATE) means rolled back', () => {
    const f = classifyWriteFailure(Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }));
    expect(f).toMatchObject({ kind: 'rolled_back', code: '23505', raceLost: false, lockHeld: false });
  });

  it('recognises our own race-check error, and the held lock', () => {
    const race = classifyWriteFailure(
      Object.assign(new Error(`invalid input syntax for type integer: "${RACE_CHECK_MARKER}: expected 13 guarded row(s) to be touched but 12 were. tag journal #1 (touched 0, expected 1); The data changed. Nothing was committed."`), { code: '22P02' }),
    );
    expect(race).toMatchObject({ kind: 'rolled_back', code: '22P02', raceLost: true, lockHeld: false });
    const lock = classifyWriteFailure(
      Object.assign(new Error(`invalid input syntax for type integer: "${RACE_CHECK_MARKER}: another data-plan run holds the loader lock (key 727401). Nothing was committed."`), { code: '22P02' }),
    );
    expect(lock).toMatchObject({ raceLost: true, lockHeld: true });
  });

  it('anything without a SQLSTATE is an unknown outcome: the batch may have committed', () => {
    expect(classifyWriteFailure(new Error('Error connecting to database: socket hang up')).kind).toBe('unknown');
    expect(classifyWriteFailure(new Error('Server error (HTTP status 502): bad gateway')).kind).toBe('unknown');
    expect(classifyWriteFailure(Object.assign(new Error('x'), { code: 'ECONNRESET' })).kind).toBe('unknown');
    expect(classifyWriteFailure('boom').kind).toBe('unknown');
    expect(classifyWriteFailure(null).kind).toBe('unknown');
  });

  it('raceDetail strips the Postgres wrapper', () => {
    expect(raceDetail(`invalid input syntax for type integer: "${RACE_CHECK_MARKER}: expected 3 guarded row(s)."`)).toBe(`${RACE_CHECK_MARKER}: expected 3 guarded row(s).`);
    expect(raceDetail('something else')).toBe('something else');
  });
});
