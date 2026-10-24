import { readFile } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client, Pool } from 'pg';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CategorizationResult } from '../types';

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock('@/lib/db', () => ({ getDb: () => ({ execute: mocks.execute }) }));
import { categorizationJobRepo } from './repository';

const url = process.env.DATA_PLAN_TEST_PG_URL;
const result = (overrides: Partial<CategorizationResult> = {}): CategorizationResult => ({
  total: 100, ruleBased: 1, aiCategorized: 32, learned: 0, reviewQueued: 23, aiNoMatch: 23,
  conflicts: 0, batches: 10, remaining: 1103, available: 764, needsReview: 339, scopeAvailable: 764,
  aiSkippedReason: 'The processing time budget was reached.', deferredReason: 'time_budget',
  hasMore: true, busy: false, status: 'partial', reviewUrl: '/data', ...overrides,
});

describe.skipIf(!url)('durable categorisation jobs in disposable PostgreSQL', () => {
  const namespace = `categorization_jobs_${randomBytes(8).toString('hex')}`;
  let fixture: Client;
  let pool: Pool;

  beforeAll(async () => {
    fixture = new Client({ connectionString: url });
    await fixture.connect();
    await fixture.query(`CREATE SCHEMA "${namespace}"`);
    await fixture.query(`SET search_path TO "${namespace}", public`);
    await fixture.query('CREATE TABLE journal_entries (id integer PRIMARY KEY)');
    const migration = await readFile(new URL('../../db/migration.sql', import.meta.url), 'utf8');
    const marker = migration.indexOf('-- Durable automatic processing authorisations');
    if (marker < 0) throw new Error('Missing durable job migration.');
    const nextSection = migration.indexOf('-- Private confirmed payee meanings', marker);
    const jobMigration = migration.slice(marker, nextSection < 0 ? undefined : nextSection);
    await fixture.query(jobMigration);
    await fixture.query(jobMigration);
    pool = new Pool({ connectionString: url, max: 4, options: `-c search_path=${namespace},public` });
    const dialect = new PgDialect();
    mocks.execute.mockImplementation((query: SQL) => {
      const rendered = dialect.sqlToQuery(query);
      return pool.query(rendered.sql, rendered.params);
    });
  });
  afterAll(async () => {
    await pool?.end();
    if (fixture) { await fixture.query(`DROP SCHEMA IF EXISTS "${namespace}" CASCADE`); await fixture.end(); }
  });
  beforeEach(async () => {
    await fixture.query('TRUNCATE categorization_job_passes, categorization_jobs, journal_entries');
    await fixture.query('INSERT INTO journal_entries(id) VALUES (1), (100)');
  });

  it('deduplicates concurrent starts atomically and fixes the original ledger snapshot', async () => {
    const jobs = await Promise.all(Array.from({ length: 4 }, () => categorizationJobRepo.start(randomUUID())));
    expect(new Set(jobs.map(job => job.id)).size).toBe(1);
    expect(jobs[0].maxJournalId).toBe(100);
    await fixture.query('INSERT INTO journal_entries(id) VALUES (200)');
    expect((await categorizationJobRepo.start(randomUUID())).maxJournalId).toBe(100);
    expect((await fixture.query('SELECT count(*) FROM categorization_jobs')).rows[0].count).toBe('1');
  });

  it('allows one worker and acknowledges a completed pass only once under concurrent completion', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    const tokens = [randomUUID(), randomUUID()];
    const claims = await Promise.all(tokens.map(token => categorizationJobRepo.claim(job.id, token)));
    expect(claims.filter(Boolean)).toHaveLength(1);
    const token = claims.find(Boolean)!.leaseToken!;
    const passId = randomUUID();
    expect(await categorizationJobRepo.beginPass(job.id, token, passId)).toBe(true);
    const completions = await Promise.all([1, 2].map(() => categorizationJobRepo.finishPass(job.id, token, passId, result(), 'queued', null)));
    expect(completions.filter(Boolean)).toHaveLength(1);
    const saved = (await categorizationJobRepo.get(job.id))!;
    expect(saved).toMatchObject({ passes: 1, status: 'running', countsExact: true, totals: { aiCategorized: 32, ruleBased: 1, reviewQueued: 23 } });
    await categorizationJobRepo.release(job.id, token);
    expect((await categorizationJobRepo.get(job.id))?.status).toBe('queued');
  });

  it('recovers an expired worker without inventing its unacknowledged pass totals', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    const oldToken = randomUUID();
    await categorizationJobRepo.claim(job.id, oldToken);
    const passId = randomUUID();
    await categorizationJobRepo.beginPass(job.id, oldToken, passId);
    await fixture.query("UPDATE categorization_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    const newToken = randomUUID();
    expect(await categorizationJobRepo.claim(job.id, newToken)).toMatchObject({ leaseToken: newToken, countsExact: false, passes: 0, totals: { aiCategorized: 0 } });
    expect(await categorizationJobRepo.finishPass(job.id, oldToken, passId, result(), 'queued', null)).toBeNull();
    expect(await categorizationJobRepo.release(job.id, oldToken)).toBeNull();
    expect((await categorizationJobRepo.get(job.id))?.leaseToken).toBe(newToken);
    expect((await fixture.query('SELECT status FROM categorization_job_passes WHERE id=$1', [passId])).rows[0].status).toBe('abandoned');
  });

  it.each(['pause', 'cancel'] as const)('finalises an expired worker with a pending %s without starting another pass', async action => {
    const job = await categorizationJobRepo.start(randomUUID());
    const token = randomUUID();
    await categorizationJobRepo.claim(job.id, token);
    await categorizationJobRepo.beginPass(job.id, token, randomUUID());
    await categorizationJobRepo.control(job.id, action);
    await fixture.query("UPDATE categorization_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    const replacement = randomUUID();
    expect(await categorizationJobRepo.claim(job.id, replacement)).toMatchObject({
      status: action === 'pause' ? 'paused' : 'cancelled', countsExact: false, leaseToken: null,
    });
    expect(await categorizationJobRepo.beginPass(job.id, replacement, randomUUID())).toBe(false);
  });

  it('marks an unfinished pass as unknown when its worker releases without acknowledgement', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    const token = randomUUID();
    await categorizationJobRepo.claim(job.id, token);
    await categorizationJobRepo.beginPass(job.id, token, randomUUID());
    expect(await categorizationJobRepo.release(job.id, token)).toMatchObject({ status: 'queued', countsExact: false, passes: 0 });
    expect((await fixture.query('SELECT status FROM categorization_job_passes')).rows[0].status).toBe('abandoned');
  });

  it.each(['pause', 'cancel'] as const)('honours %s after an in-flight pass while retaining its actual acknowledgements', async action => {
    const job = await categorizationJobRepo.start(randomUUID());
    const token = randomUUID();
    await categorizationJobRepo.claim(job.id, token);
    const passId = randomUUID();
    await categorizationJobRepo.beginPass(job.id, token, passId);
    expect((await categorizationJobRepo.control(job.id, action))?.status).toBe('running');
    const saved = await categorizationJobRepo.finishPass(job.id, token, passId, result(), 'queued', null);
    expect(saved).toMatchObject({ status: action === 'pause' ? 'paused' : 'cancelled', passes: 1, totals: { aiCategorized: 32 } });
    expect(await categorizationJobRepo.beginPass(job.id, token, randomUUID())).toBe(false);
    await categorizationJobRepo.release(job.id, token);
    expect((await categorizationJobRepo.get(job.id))?.totals.aiCategorized).toBe(32);
  });

  it('does not restart a paused job from start calls; explicit resume grants another bounded window', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    const paused = await categorizationJobRepo.control(job.id, 'pause');
    expect(paused?.status).toBe('paused');
    expect(await categorizationJobRepo.start(randomUUID())).toMatchObject({ id: job.id, status: 'paused' });
    await fixture.query("UPDATE categorization_jobs SET passes=200,pass_limit=200,pause_reason='processing_limit' WHERE id=$1", [job.id]);
    expect(await categorizationJobRepo.control(job.id, 'resume')).toMatchObject({ id: job.id, status: 'queued', passes: 200, passLimit: 400 });
  });

  it('pauses at the automatic pass limit without resetting already acknowledged progress', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    await fixture.query('UPDATE categorization_jobs SET passes=199 WHERE id=$1', [job.id]);
    const token = randomUUID();
    await categorizationJobRepo.claim(job.id, token);
    const passId = randomUUID();
    await categorizationJobRepo.beginPass(job.id, token, passId);
    expect(await categorizationJobRepo.finishPass(job.id, token, passId, result(), 'queued', null)).toMatchObject({ status: 'paused', pauseReason: 'processing_limit', passes: 200, totals: { aiCategorized: 32 } });
  });

  it('marks an unknown failed pass without losing previously confirmed totals', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    const token = randomUUID();
    await categorizationJobRepo.claim(job.id, token);
    const pass1 = randomUUID();
    await categorizationJobRepo.beginPass(job.id, token, pass1);
    await categorizationJobRepo.finishPass(job.id, token, pass1, result(), 'queued', null);
    const pass2 = randomUUID();
    await categorizationJobRepo.beginPass(job.id, token, pass2);
    await categorizationJobRepo.failPass(job.id, token, pass2);
    await categorizationJobRepo.release(job.id, token);
    expect(await categorizationJobRepo.get(job.id)).toMatchObject({ status: 'paused', countsExact: false, passes: 1, totals: { aiCategorized: 32 }, pauseReason: 'processing_failed' });
  });

  it('keeps latest terminal status and records dispatch issues without changing progress', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    await categorizationJobRepo.recordDispatch(job.id, false, 'Background handoff could not be confirmed.');
    expect(await categorizationJobRepo.get()).toMatchObject({ id: job.id, status: 'queued', passes: 0, dispatchIssue: 'Background handoff could not be confirmed.' });
    await categorizationJobRepo.control(job.id, 'cancel');
    expect((await categorizationJobRepo.get())?.status).toBe('cancelled');
    expect((await categorizationJobRepo.start(randomUUID())).id).not.toBe(job.id);
  });

  it('timestamps queued handoff attempts for backoff without extending a running worker lease', async () => {
    const job = await categorizationJobRepo.start(randomUUID());
    await fixture.query("UPDATE categorization_jobs SET updated_at=now()-interval '1 minute' WHERE id=$1", [job.id]);
    const before = (await categorizationJobRepo.get(job.id))!;
    await categorizationJobRepo.recordDispatch(job.id, false, 'Handoff was not confirmed.');
    const queued = (await categorizationJobRepo.get(job.id))!;
    expect(new Date(queued.updatedAt).getTime()).toBeGreaterThan(new Date(before.updatedAt).getTime());
    const token = randomUUID();
    const running = (await categorizationJobRepo.claim(job.id, token))!;
    await categorizationJobRepo.recordDispatch(job.id, false, 'A duplicate handoff was not confirmed.');
    const after = (await categorizationJobRepo.get(job.id))!;
    expect(after.updatedAt).toBe(running.updatedAt);
    expect(after.leaseExpiresAt).toBe(running.leaseExpiresAt);
    await fixture.query("UPDATE categorization_jobs SET updated_at=now()-interval '1 minute',lease_expires_at=now()-interval '1 second' WHERE id=$1", [job.id]);
    const expired = (await categorizationJobRepo.get(job.id))!;
    await categorizationJobRepo.recordDispatch(job.id, false, 'Expired worker handoff was not confirmed.');
    const attempted = (await categorizationJobRepo.get(job.id))!;
    expect(new Date(attempted.updatedAt).getTime()).toBeGreaterThan(new Date(expired.updatedAt).getTime());
    expect(attempted.leaseExpiresAt).toBe(expired.leaseExpiresAt);
  });
});
