import { randomBytes } from 'node:crypto';
import { Client, Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({ db: undefined as unknown, execute: vi.fn() }));
vi.mock('@/lib/db', async () => ({ getDb: () => mocks.db, schema: await import('@/lib/db/schema') }));
import { readWorkspace, writeWorkspace, WorkspaceConflictError, WorkspaceStoredDataError } from './store';
import { workspaceErrorResponse } from './api';

const url = process.env.DATA_PLAN_TEST_PG_URL;
const key = 'finance.workspace.regression';
const dataSchema = z.object({
  amount: z.string().regex(/^-?\d+\.\d{2}$/),
  deductions: z.array(z.string().regex(/^-?\d+\.\d{2}$/)),
}).strict();
const initial = { amount: '0.00', deductions: [] };
const facts = { amount: '123456789012.34', deductions: ['0.01', '-250.50'] };

// Two actual PostgreSQL connections share only an isolated, randomly named
// schema. This is necessary to exercise row-lock/CAS concurrency: TEMP tables
// on a single session cannot demonstrate simultaneous conflicting writes.
describe.skipIf(!url)('financial workspace CAS inside disposable PostgreSQL', () => {
  let fixture: Client;
  let pool: Pool;
  const testSchema = `finance_workspace_test_${randomBytes(8).toString('hex')}`;
  let beforeWrite: (() => Promise<void>) | null = null;
  let barrier: {
    arrived: number;
    pids: Set<number>;
    ready: Promise<void>;
    release: () => void;
  } | null = null;

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${testSchema}"`);
    await fixture.query(`SET search_path TO "${testSchema}", public`);
    await fixture.query('CREATE TABLE app_settings (key text PRIMARY KEY, value text NOT NULL, updated_at timestamp NOT NULL DEFAULT now())');
    pool = new Pool({ connectionString: url, max: 2, options: `-c search_path=${testSchema},public` });
    const db = drizzle(pool);
    const dialect = new PgDialect();
    mocks.execute.mockImplementation(async (statement: SQL) => {
      const { sql, params } = dialect.sqlToQuery(statement);
      if (beforeWrite) {
        const hook = beforeWrite;
        beforeWrite = null;
        await hook();
      }
      if (barrier && /\bINSERT\s+INTO\s+app_settings\b/i.test(sql)) {
        const shared = barrier;
        const connection = await pool.connect();
        try {
          shared.pids.add((await connection.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
          shared.arrived += 1;
          if (shared.arrived === 2) shared.release();
          await shared.ready;
          return await connection.query(sql, params);
        } finally {
          connection.release();
        }
      }
      return pool.query(sql, params);
    });
    // Reads go through the real appSettingsRepo and Drizzle query builder.
    // Only execute is redirected so the concurrent test can rendezvous both
    // statements after their preflight reads and before the atomic CAS.
    mocks.db = { select: db.select.bind(db), execute: mocks.execute };
  });
  afterAll(async () => {
    barrier?.release();
    await pool?.end();
    if (fixture) {
      await fixture.query(`DROP SCHEMA IF EXISTS "${testSchema}" CASCADE`);
      await fixture.end();
    }
  });
  beforeEach(async () => {
    beforeWrite = null;
    barrier = null;
    mocks.execute.mockClear();
    await fixture.query('TRUNCATE app_settings');
  });
  const raw = async () => (await fixture.query('SELECT value FROM app_settings WHERE key = $1', [key])).rows[0]?.value ?? null;
  const storeRaw = (value: string) => fixture.query('INSERT INTO app_settings (key, value) VALUES ($1, $2)', [key, value]);

  it('distinguishes an absent revision-zero workspace from a saved zero and round-trips exact decimal strings', async () => {
    expect(await readWorkspace(key, dataSchema, initial)).toEqual({ version: 1, revision: 0, updatedAt: null, data: initial });
    expect(await raw()).toBeNull();
    const saved = await writeWorkspace(key, dataSchema, facts, 0);
    expect(saved).toMatchObject({ version: 1, revision: 1, data: facts });
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await readWorkspace(key, dataSchema, initial)).toEqual(saved);
    expect(JSON.parse(await raw()).data).toEqual(facts);
    const savedZero = await writeWorkspace(key, dataSchema, initial, saved.revision);
    expect(savedZero).toMatchObject({ version: 1, revision: 2, data: initial });
    expect(savedZero.updatedAt).not.toBeNull();
    expect(await readWorkspace(key, dataSchema, initial)).toEqual(savedZero);
  });

  async function simultaneousWrites(expectedRevision: number) {
    let release!: () => void;
    const ready = new Promise<void>(resolve => { release = resolve; });
    const shared = { arrived: 0, pids: new Set<number>(), ready, release };
    barrier = shared;
    // Unblock on a test failure rather than leaving a checked-out connection.
    const timeout = setTimeout(release, 3000);
    try {
      const outcomes = await Promise.allSettled([
        writeWorkspace(key, dataSchema, { amount: '10.01', deductions: [] }, expectedRevision),
        writeWorkspace(key, dataSchema, { amount: '20.02', deductions: [] }, expectedRevision),
      ]);
      expect(shared.arrived).toBe(2);
      expect(shared.pids.size).toBe(2);
      const winners = outcomes.filter(outcome => outcome.status === 'fulfilled');
      const losers = outcomes.filter(outcome => outcome.status === 'rejected');
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      expect(losers[0].reason).toBeInstanceOf(WorkspaceConflictError);
      expect(workspaceErrorResponse(losers[0].reason).status).toBe(409);
      const persisted = await readWorkspace(key, dataSchema, initial);
      expect(persisted).toEqual(winners[0].value);
      expect(persisted.revision).toBe(expectedRevision + 1);
    } finally {
      clearTimeout(timeout);
      release();
      barrier = null;
    }
  }

  it('allows exactly one of two simultaneous revision-zero creations', async () => {
    await simultaneousWrites(0);
  });

  it('allows exactly one of two simultaneous writes of the same existing revision', async () => {
    await writeWorkspace(key, dataSchema, facts, 0);
    await simultaneousWrites(1);
  });

  it('rejects stale revisions without replacing the newer financial facts', async () => {
    const first = await writeWorkspace(key, dataSchema, facts, 0);
    const newer = await writeWorkspace(key, dataSchema, { amount: '99.99', deductions: ['0.01'] }, first.revision);
    await expect(writeWorkspace(key, dataSchema, initial, first.revision)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await readWorkspace(key, dataSchema, initial)).toEqual(newer);
  });

  it('cannot resurrect a missing nonzero revision, even if the row disappears after the preflight read', async () => {
    await expect(writeWorkspace(key, dataSchema, initial, 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await raw()).toBeNull();
    await writeWorkspace(key, dataSchema, facts, 0);
    beforeWrite = async () => { await fixture.query('DELETE FROM app_settings WHERE key = $1', [key]); };
    await expect(writeWorkspace(key, dataSchema, initial, 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await raw()).toBeNull();
  });

  it('protects an unsupported stored version before and during an attempted update', async () => {
    const unsupported = JSON.stringify({ version: 2, revision: 1, updatedAt: '2026-10-11T12:00:00.000Z', data: facts });
    await storeRaw(unsupported);
    await expect(readWorkspace(key, dataSchema, initial)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    await expect(writeWorkspace(key, dataSchema, initial, 1)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    expect(await raw()).toBe(unsupported);
    await fixture.query('TRUNCATE app_settings');
    await writeWorkspace(key, dataSchema, facts, 0);
    beforeWrite = async () => { await fixture.query('UPDATE app_settings SET value = $1 WHERE key = $2', [unsupported, key]); };
    await expect(writeWorkspace(key, dataSchema, initial, 1)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(await raw()).toBe(unsupported);
  });

  it.each([
    '{broken',
    JSON.stringify({ version: 1, revision: 1, updatedAt: '2026-10-11T12:00:00.000Z', data: { amount: 125.5, deductions: [] } }),
    JSON.stringify({ version: 1, revision: 0, updatedAt: null, data: facts }),
  ])('rejects malformed saved data without returning defaults or overwriting the record', async value => {
    await storeRaw(value);
    await expect(readWorkspace(key, dataSchema, initial)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    await expect(writeWorkspace(key, dataSchema, initial, 0)).rejects.toBeInstanceOf(WorkspaceStoredDataError);
    expect(await raw()).toBe(value);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('rejects missing, negative and non-integer expected revisions before writing', async () => {
    for (const expected of [undefined, null, -1, 0.5, Number.NaN, 1_000_000_000]) {
      await expect(writeWorkspace(key, dataSchema, initial, expected as number)).rejects.toBeInstanceOf(z.ZodError);
    }
    expect(await raw()).toBeNull();
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
