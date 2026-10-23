import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyChange, type Queryable } from './statements';
import { guardedWrite, raceCheckStatement, setupStatement } from './http-statements';
import type { Change } from './types';
import { TaxProfileConflictError } from '@/lib/tax/profileFacts';

const mocks = vi.hoisted(() => ({ db: null as unknown }));
vi.mock('@/lib/db', async () => ({ getDb: () => mocks.db, schema: await import('@/lib/db/schema') }));
vi.mock('@/lib/repos/property.repo', () => ({ propertyRepo: { getOwner: async (id: number) => ({ id, name: 'Fixture owner' }) } }));
vi.mock('@/lib/repos/owner-report.repo', () => ({ ownerReportRepo: {} }));
import { ownerTaxRepo } from '@/lib/repos/owner-tax.repo';

const url = process.env.DATA_PLAN_TEST_PG_URL;
describe.skipIf(!url)('data-plan tax profile writers share editor revision guards', () => {
  const name = `plan_tax_${randomBytes(8).toString('hex')}`;
  let writer: Client;
  let editor: Client;
  beforeAll(async () => {
    writer = new Client({ connectionString: url });
    editor = new Client({ connectionString: url });
    await Promise.all([writer.connect(), editor.connect()]);
    await writer.query(`CREATE SCHEMA "${name}"`);
    await Promise.all([writer.query(`SET search_path TO "${name}"`), editor.query(`SET search_path TO "${name}"`)]);
    await writer.query(`CREATE TABLE owner_tax_profiles (
      id serial PRIMARY KEY, owner_id integer NOT NULL, tax_year text NOT NULL,
      employment_income numeric(14,2) NOT NULL DEFAULT 0, paye_tax_paid numeric(14,2) NOT NULL DEFAULT 0,
      self_employment_income numeric(14,2) NOT NULL DEFAULT 0, savings_interest numeric(14,2) NOT NULL DEFAULT 0,
      dividends numeric(14,2) NOT NULL DEFAULT 0, other_income numeric(14,2) NOT NULL DEFAULT 0,
      property_losses_brought_forward numeric(14,2) NOT NULL DEFAULT 0,
      finance_costs_brought_forward numeric(14,2) NOT NULL DEFAULT 0, notes text,
      facts jsonb NOT NULL DEFAULT '{}', known_fields jsonb, field_sources jsonb NOT NULL DEFAULT '{}',
      revision integer NOT NULL DEFAULT 1, created_at timestamp NOT NULL DEFAULT now(), updated_at timestamp NOT NULL DEFAULT now(),
      UNIQUE(owner_id,tax_year))`);
    mocks.db = drizzle(editor);
  });
  beforeEach(async () => { await writer.query('TRUNCATE owner_tax_profiles'); });
  afterAll(async () => {
    await editor?.end();
    if (writer) { await writer.query(`DROP SCHEMA "${name}" CASCADE`); await writer.end(); }
  });

  const change = (existed = false, revision = 0, set: Extract<Change, { type: 'tax_profile' }>['set'] = { employmentIncome: '95000.00', payeTaxPaid: '0.00' }): Extract<Change, { type: 'tax_profile' }> => ({
    type: 'tax_profile', itemIds: ['fixture'], ownerId: 1, ownerName: 'Fixture owner', taxYear: '2026-27',
    existed, expectedRevision: revision, set, previous: existed ? { employmentIncome: '90000.00' } : null,
    notes: null, previousNotes: null,
  });
  async function run(c: Extract<Change, { type: 'tax_profile' }>, mode: 'interactive' | 'http') {
    await writer.query('BEGIN');
    try {
      if (mode === 'interactive') await applyChange(writer as unknown as Queryable, c);
      else for (const s of [setupStatement(), guardedWrite(c)!, raceCheckStatement(1)]) await writer.query(s.text, s.params);
      await writer.query('COMMIT');
    } catch (error) { await writer.query('ROLLBACK'); throw error; }
  }
  for (const mode of ['interactive', 'http'] as const) describe(mode, () => {
    it('saves only supplied evidence, including a confirmed zero', async () => {
      await run(change(), mode);
      const profile = await ownerTaxRepo.getProfile(1, '2026-27');
      expect(profile).toMatchObject({ revision: 1, employmentIncome: '95000.00', payeTaxPaid: '0.00' });
      expect(profile.knownFields.sort()).toEqual(['employmentIncome', 'payeTaxPaid']);
      expect(profile.fieldSources.payeTaxPaid.source).toBe('user');
      expect(profile.knownFields).not.toContain('dividends');
      await expect(run(change(), mode)).rejects.toThrow();
    });
    it('advances the revision and preserves PAYE, facts and unrelated provenance', async () => {
      await ownerTaxRepo.patchProfile(1, '2026-27', { expectedRevision: 0, source: 'ai', employmentIncome: '90000.00', payeTaxPaid: '23000.00', facts: { baseSalary: '95000.00' } });
      await run(change(true, 1, { employmentIncome: '123500.00' }), mode);
      const profile = await ownerTaxRepo.getProfile(1, '2026-27');
      expect(profile).toMatchObject({ revision: 2, employmentIncome: '123500.00', payeTaxPaid: '23000.00', facts: { baseSalary: '95000.00' } });
      expect(profile.fieldSources.employmentIncome.source).toBe('user');
      expect(profile.fieldSources.payeTaxPaid.source).toBe('ai');
      await expect(ownerTaxRepo.patchProfile(1, '2026-27', { expectedRevision: 1, source: 'user', employmentIncome: '1.00' })).rejects.toBeInstanceOf(TaxProfileConflictError);
    });
    it('rejects a plan after a concurrent facts-only editor update', async () => {
      await ownerTaxRepo.patchProfile(1, '2026-27', { expectedRevision: 0, source: 'user', employmentIncome: '90000.00' });
      const reviewed = change(true, 1, { employmentIncome: '123500.00' });
      await ownerTaxRepo.patchProfile(1, '2026-27', { expectedRevision: 1, source: 'ai', facts: { employeePensionPercent: 8 } });
      await expect(run(reviewed, mode)).rejects.toThrow();
      expect(await ownerTaxRepo.getProfile(1, '2026-27')).toMatchObject({ revision: 2, employmentIncome: '90000.00', facts: { employeePensionPercent: 8 } });
    });
    it('preserves legacy non-zero evidence without confirming omitted zero defaults', async () => {
      await writer.query("INSERT INTO owner_tax_profiles(owner_id,tax_year,employment_income) VALUES (1,'2026-27',90000)");
      const notesOnly = { ...change(true, 1, {}), notes: 'Reviewed plan note.' };
      await run(notesOnly, mode);
      const profile = await ownerTaxRepo.getProfile(1, '2026-27');
      expect(profile).toMatchObject({ revision: 2, notes: 'Reviewed plan note.', knownFields: ['employmentIncome'] });
      expect(profile.fieldSources.employmentIncome.source).toBe('legacy');
      expect(profile.fieldSources.payeTaxPaid).toBeUndefined();
    });
  });
});
