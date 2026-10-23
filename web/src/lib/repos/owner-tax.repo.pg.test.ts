import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Client, Pool, type QueryConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/lib/errors';
import { TaxProfileConflictError } from '@/lib/tax/profileFacts';

const mocks = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock('@/lib/db', async () => ({ getDb: () => mocks.db, schema: await import('@/lib/db/schema') }));
vi.mock('./property.repo', () => ({ propertyRepo: {
  getOwner: async (id: number) => [1, 2].includes(id) ? { id, name: `Owner ${id}` } : null,
} }));
vi.mock('./owner-report.repo', () => ({ ownerReportRepo: {
  getTaxYearReport: async ({ ownerId }: { ownerId: number }) => ({ owner: { id: ownerId, name: `Owner ${ownerId}` }, properties: [] }),
} }));
import * as schema from '@/lib/db/schema';
import { ownerTaxRepo } from './owner-tax.repo';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('owner tax partial profiles in disposable PostgreSQL', () => {
  const testSchema = `tax_profile_test_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;
  let barrier: { arrived: number; pids: Set<number>; ready: Promise<void>; release: () => void } | null = null;

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${testSchema}"`);
    await fixture.query(`SET search_path TO "${testSchema}", public`);
    // Start with the old table so the actual additive migration is exercised.
    await fixture.query(`CREATE TABLE owner_tax_profiles (
      id serial PRIMARY KEY, owner_id integer NOT NULL, tax_year text NOT NULL,
      employment_income numeric(14,2) NOT NULL DEFAULT 0,
      paye_tax_paid numeric(14,2) NOT NULL DEFAULT 0,
      self_employment_income numeric(14,2) NOT NULL DEFAULT 0,
      savings_interest numeric(14,2) NOT NULL DEFAULT 0, dividends numeric(14,2) NOT NULL DEFAULT 0,
      other_income numeric(14,2) NOT NULL DEFAULT 0,
      property_losses_brought_forward numeric(14,2) NOT NULL DEFAULT 0,
      finance_costs_brought_forward numeric(14,2) NOT NULL DEFAULT 0,
      notes text, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(owner_id, tax_year))`);
    const migration = await readFile(new URL('../db/migration.sql', import.meta.url), 'utf8');
    const alters = migration.match(/ALTER TABLE owner_tax_profiles ADD COLUMN IF NOT EXISTS[^;]+;/g)!;
    expect(alters).toHaveLength(4);
    await fixture.query(alters.join('\n'));
    await fixture.query(alters.join('\n')); // repeat deploys preserve values
    pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${testSchema},public` });
    const proxyPool = {
      query: async (query: QueryConfig, params?: unknown[]) => {
        const text = typeof query === 'string' ? query : query.text;
        if (barrier && /^(insert into|update) "owner_tax_profiles"/i.test(text)) {
          const shared = barrier;
          const connection = await pool.connect();
          try {
            shared.pids.add((await connection.query('select pg_backend_pid() AS pid')).rows[0].pid);
            shared.arrived++;
            if (shared.arrived === 2) shared.release();
            await shared.ready;
            return await connection.query(query, params);
          } finally { connection.release(); }
        }
        return pool.query(query, params);
      },
    } as unknown as Pool;
    mocks.db = drizzle({ client: proxyPool, schema });
  });
  beforeEach(async () => {
    barrier = null;
    await fixture.query('TRUNCATE owner_tax_profiles');
  });
  afterAll(async () => {
    barrier?.release();
    await pool?.end();
    if (fixture) {
      await fixture.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await fixture.end();
    }
  });
  const patch = (ownerId: number, year: string, expectedRevision: number, data: Record<string, unknown>) =>
    ownerTaxRepo.patchProfile(ownerId, year, { expectedRevision, source: 'ai', ...data });

  it('keeps missing profile values unknown and saves explicit zero as known', async () => {
    expect(await ownerTaxRepo.getProfile(1, '2026-27')).toMatchObject({ saved: false, revision: 0, knownFields: [] });
    const first = await patch(1, '2026-27', 0, { employmentIncome: '123500', payeTaxPaid: 0 });
    expect(first).toMatchObject({ saved: true, revision: 1, employmentIncome: '123500.00', payeTaxPaid: '0.00', knownFields: ['employmentIncome', 'payeTaxPaid'] });
    expect(first.fieldSources.employmentIncome.source).toBe('ai');
    const next = await patch(1, '2026-27', 1, { employmentIncome: null, facts: { employeePensionPercent: 8, employerPensionPercent: 8 } });
    expect(next.knownFields).toEqual(['payeTaxPaid']);
    expect(next.employmentIncome).toBe('0.00');
    expect(next.facts).toMatchObject({ employeePensionPercent: 8, employerPensionPercent: 8, pensionMethod: 'unknown', pensionAnnualAmount: null });
    expect(await ownerTaxRepo.getProfile(1, '2026-27')).toEqual(next);
  });

  it('preserves PAYE, other facts and notes during an unrelated partial update', async () => {
    await patch(1, '2026-27', 0, { employmentIncome: 123500, payeTaxPaid: '41000.23', notes: 'From P60', facts: { baseSalary: 95000, bonusPercent: 30, bonusIsEstimate: true } });
    const changed = await patch(1, '2026-27', 1, { facts: { employeePensionPercent: 8 } });
    expect(changed).toMatchObject({ employmentIncome: '123500.00', payeTaxPaid: '41000.23', notes: 'From P60', revision: 2 });
    expect(changed.facts).toMatchObject({ baseSalary: '95000.00', bonusPercent: 30, employeePensionPercent: 8 });
  });

  it('supersedes an old bonus representation without adding both to income', async () => {
    await patch(1, '2026-27', 0, { facts: { baseSalary: 95000, bonusPercent: 30, bonusIsEstimate: true } });
    const next = await patch(1, '2026-27', 1, { facts: { bonusAmount: 28000 } });
    expect(next.facts).toMatchObject({ baseSalary: '95000.00', bonusPercent: null, bonusAmount: '28000.00' });
  });

  it('isolates each owner and tax year and rejects absent owners', async () => {
    await patch(1, '2025-26', 0, { payeTaxPaid: 20000 });
    await patch(2, '2026-27', 0, { payeTaxPaid: 30000 });
    expect(await ownerTaxRepo.getProfile(1, '2026-27')).toMatchObject({ revision: 0, knownFields: [] });
    expect(await ownerTaxRepo.getProfile(1, '2025-26')).toMatchObject({ payeTaxPaid: '20000.00' });
    expect(await ownerTaxRepo.getProfile(2, '2026-27')).toMatchObject({ payeTaxPaid: '30000.00' });
    await expect(patch(99, '2026-27', 0, { payeTaxPaid: 0 })).rejects.toBeInstanceOf(NotFoundError);
  });

  it('treats old zero defaults as unknown and preserves nonzero legacy amounts', async () => {
    await fixture.query("INSERT INTO owner_tax_profiles(owner_id,tax_year,employment_income,paye_tax_paid) VALUES (1,'2026-27',95000,23000)");
    const old = await ownerTaxRepo.getProfile(1, '2026-27');
    expect(old).toMatchObject({ legacyProfile: true, revision: 1, knownFields: ['employmentIncome', 'payeTaxPaid'] });
    expect(old.fieldSources.employmentIncome.source).toBe('legacy');
    const updated = await patch(1, '2026-27', 1, { facts: { employeePensionPercent: 8 } });
    expect(updated).toMatchObject({ employmentIncome: '95000.00', payeTaxPaid: '23000.00', legacyProfile: false, knownFields: ['employmentIncome', 'payeTaxPaid'] });
    expect(updated.fieldSources.employmentIncome.source).toBe('legacy');
  });

  async function race(revision: number) {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const shared = { arrived: 0, pids: new Set<number>(), ready, release };
    barrier = shared;
    const timeout = setTimeout(release, 3000);
    try {
      const outcomes = await Promise.allSettled([
        patch(1, '2026-27', revision, { employmentIncome: 95000 }),
        patch(1, '2026-27', revision, { employmentIncome: 123500 }),
      ]);
      expect(shared.arrived).toBe(2);
      expect(shared.pids.size).toBe(2);
      const winner = outcomes.filter(result => result.status === 'fulfilled');
      const loser = outcomes.filter(result => result.status === 'rejected');
      expect(winner).toHaveLength(1);
      expect(loser).toHaveLength(1);
      expect(loser[0].reason).toBeInstanceOf(TaxProfileConflictError);
      expect(await ownerTaxRepo.getProfile(1, '2026-27')).toEqual(winner[0].value);
    } finally { clearTimeout(timeout); release(); barrier = null; }
  }
  it('allows exactly one simultaneous first creation on two actual connections', () => race(0));
  it('allows exactly one simultaneous edit of the same revision on two actual connections', async () => {
    await patch(1, '2026-27', 0, { payeTaxPaid: 1234 });
    await race(1);
    expect((await ownerTaxRepo.getProfile(1, '2026-27')).payeTaxPaid).toBe('1234.00');
  });
  it('rejects stale edits without altering the newer facts', async () => {
    await patch(1, '2026-27', 0, { facts: { employeePensionPercent: 8 } });
    const newer = await patch(1, '2026-27', 1, { facts: { employeePensionPercent: 10 } });
    await expect(patch(1, '2026-27', 1, { facts: { employeePensionPercent: 1 } })).rejects.toBeInstanceOf(TaxProfileConflictError);
    expect(await ownerTaxRepo.getProfile(1, '2026-27')).toEqual(newer);
  });

  it('keeps incomplete salary, PAYE, pension and residence inputs out of an amount to pay', async () => {
    await patch(1, '2026-27', 0, { facts: { baseSalary: 95000, bonusPercent: 30, bonusIsEstimate: true,
      employeePensionPercent: 8, employerPensionPercent: 8 } });
    const result = await ownerTaxRepo.getTaxComputation({ ownerId: 1, year: '2026-27' });
    expect(result).toMatchObject({ profileSaved: true, profileComplete: false, estimateOnly: true,
      payeTaxPaidKnown: false, estimatedBalancePayable: null, income: { nonSavings: '123500.00' } });
    expect(result.profileGaps.some(gap => gap.includes('PAYE'))).toBe(true);
    expect(result.profileGaps.some(gap => gap.includes('pension'))).toBe(true);
    expect(result.warnings.some(warning => warning.includes('zero placeholders'))).toBe(true);
  });

  it('requires explicit pension evidence even when every legacy monetary field is supplied', async () => {
    await patch(1, '2026-27', 0, { employmentIncome: 95000, payeTaxPaid: 25000, selfEmploymentIncome: 0,
      savingsInterest: 0, dividends: 0, otherIncome: 0, propertyLossesBroughtForward: 0,
      financeCostsBroughtForward: 0, facts: { jurisdiction: 'england_wales_ni' } });
    const unknownPension = await ownerTaxRepo.getTaxComputation({ ownerId: 1, year: '2026-27' });
    expect(unknownPension).toMatchObject({ profileComplete: false, estimatedBalancePayable: null });
    expect(unknownPension.profileGaps.some(gap => gap.includes('pension'))).toBe(true);
    await patch(1, '2026-27', 1, { facts: { pensionAnnualAmount: 0 } });
    const noPension = await ownerTaxRepo.getTaxComputation({ ownerId: 1, year: '2026-27' });
    expect(noPension).toMatchObject({ profileComplete: true, estimateOnly: false, payeTaxPaidKnown: true });
    expect(noPension.estimatedBalancePayable).not.toBeNull();
    expect(noPension.warnings.some(warning => warning.includes('not proof that this tax year is complete'))).toBe(true);
  });
});
