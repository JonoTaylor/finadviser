import { sql } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import type { CategorizationResult } from '../types';
import { EMPTY_JOB_TOTALS, MAX_JOB_PASSES, type StoredCategorizationJob } from './types';

function iso(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null;
  // Neon HTTP's raw execute() rows retain PostgreSQL timestamptz strings,
  // while node-postgres decodes them to Date. Normalise both driver shapes.
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function fromRow(row: Record<string, unknown> | undefined): StoredCategorizationJob | null {
  if (!row) return null;
  return {
    id: String(row.id), status: row.status as StoredCategorizationJob['status'],
    cancelRequested: row.control_action === 'cancel', pauseRequested: row.control_action === 'pause',
    countsExact: row.counts_exact === true, passes: Number(row.passes),
    totals: row.totals as StoredCategorizationJob['totals'], latestResult: row.latest_result as CategorizationResult | null,
    maxJournalId: Number(row.max_journal_id), pauseReason: row.pause_reason as string | null,
    dispatchIssue: row.dispatch_issue as string | null,
    createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)!, finishedAt: iso(row.finished_at),
    leaseToken: row.lease_token as string | null, leaseExpiresAt: iso(row.lease_expires_at), passLimit: Number(row.pass_limit),
  };
}

export const categorizationJobRepo = {
  async start(id: string): Promise<StoredCategorizationJob> {
    const result = await getDb().execute(sql`
      INSERT INTO categorization_jobs (id, slot, status, max_journal_id, totals)
      VALUES (${id}::uuid, 1, 'queued', COALESCE((SELECT max(id) FROM journal_entries), 0), ${JSON.stringify(EMPTY_JOB_TOTALS)}::jsonb)
      ON CONFLICT (slot) WHERE status IN ('queued', 'running', 'paused') DO UPDATE SET slot = EXCLUDED.slot
      RETURNING *
    `);
    return fromRow(result.rows[0])!;
  },

  async get(id?: string): Promise<StoredCategorizationJob | null> {
    const result = id ? await getDb().execute(sql`SELECT * FROM categorization_jobs WHERE id = ${id}::uuid`)
      : await getDb().execute(sql`SELECT * FROM categorization_jobs ORDER BY created_at DESC, id DESC LIMIT 1`);
    return fromRow(result.rows[0]);
  },

  /** A stale worker's unfinished pass is unknown, never counted as zero or replayed. */
  async claim(id: string, token: string): Promise<StoredCategorizationJob | null> {
    const result = await getDb().execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT * FROM categorization_jobs WHERE id = ${id}::uuid
          AND (status = 'queued' OR (status = 'running' AND lease_expires_at <= now()))
        FOR UPDATE
      ), abandoned AS (
        UPDATE categorization_job_passes p SET status = 'abandoned', finished_at = now()
        FROM locked j WHERE p.job_id = j.id AND p.status = 'running' RETURNING p.id
      )
      UPDATE categorization_jobs j SET
        status = CASE WHEN l.control_action = 'cancel' THEN 'cancelled' WHEN l.control_action = 'pause' THEN 'paused' ELSE 'running' END,
        pause_reason = CASE WHEN l.control_action = 'pause' THEN 'user_paused' ELSE NULL END,
        lease_token = CASE WHEN l.control_action IS NULL THEN ${token}::uuid ELSE NULL END,
        lease_expires_at = CASE WHEN l.control_action IS NULL THEN now() + interval '90 seconds' ELSE NULL END,
        finished_at = CASE WHEN l.control_action = 'cancel' THEN now() ELSE NULL END,
        counts_exact = j.counts_exact AND NOT EXISTS (SELECT 1 FROM abandoned), updated_at = now()
      FROM locked l WHERE j.id = l.id RETURNING j.*
    `);
    return fromRow(result.rows[0]);
  },

  async beginPass(id: string, token: string, passId: string): Promise<boolean> {
    const result = await getDb().execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT id FROM categorization_jobs
        WHERE id = ${id}::uuid AND status = 'running' AND control_action IS NULL
          AND lease_token = ${token}::uuid AND lease_expires_at > now() AND passes < pass_limit FOR UPDATE
      )
      INSERT INTO categorization_job_passes (id, job_id, worker_token, status)
      SELECT ${passId}::uuid, id, ${token}::uuid, 'running' FROM locked
      RETURNING id
    `);
    return result.rows.length === 1;
  },

  /** Pass acknowledgement and known totals change together, exactly once. */
  async finishPass(id: string, token: string, passId: string, result: CategorizationResult,
    nextStatus: 'queued' | 'paused' | 'completed', reason: string | null): Promise<StoredCategorizationJob | null> {
    const addition = Object.fromEntries(Object.keys(EMPTY_JOB_TOTALS).map(key => [key, result[key as keyof typeof EMPTY_JOB_TOTALS]]));
    const response = await getDb().execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT * FROM categorization_jobs WHERE id = ${id}::uuid AND status = 'running'
          AND lease_token = ${token}::uuid AND lease_expires_at > now() FOR UPDATE
      ), acknowledged AS (
        UPDATE categorization_job_passes p SET status = 'completed', result = ${JSON.stringify(result)}::jsonb, finished_at = now()
        FROM locked j WHERE p.id = ${passId}::uuid AND p.job_id = j.id AND p.worker_token = ${token}::uuid AND p.status = 'running'
        RETURNING p.id
      )
      UPDATE categorization_jobs j SET
        totals = (SELECT jsonb_object_agg(item.key, to_jsonb((item.value::text)::bigint + COALESCE((j.totals ->> item.key)::bigint, 0)))
          FROM jsonb_each(${JSON.stringify(addition)}::jsonb) item),
        passes = j.passes + 1, latest_result = ${JSON.stringify(result)}::jsonb,
        status = CASE WHEN j.control_action = 'cancel' THEN 'cancelled' WHEN j.control_action = 'pause' THEN 'paused'
          WHEN j.passes + 1 >= j.pass_limit AND ${nextStatus} = 'queued' THEN 'paused'
          WHEN ${nextStatus} = 'queued' THEN 'running' ELSE ${nextStatus} END,
        pause_reason = CASE WHEN j.control_action = 'pause' THEN 'user_paused'
          WHEN j.passes + 1 >= j.pass_limit AND ${nextStatus} = 'queued' THEN 'processing_limit' ELSE ${reason} END,
        finished_at = CASE WHEN j.control_action = 'cancel' THEN now() WHEN j.control_action = 'pause' THEN NULL
          WHEN ${nextStatus} = 'completed' THEN now() ELSE NULL END,
        updated_at = now(), dispatch_issue = NULL
      WHERE j.id IN (SELECT id FROM locked) AND EXISTS (SELECT 1 FROM acknowledged) RETURNING j.*
    `);
    return fromRow(response.rows[0]);
  },

  async release(id: string, token: string): Promise<StoredCategorizationJob | null> {
    const result = await getDb().execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT id FROM categorization_jobs WHERE id = ${id}::uuid AND lease_token = ${token}::uuid FOR UPDATE
      ), abandoned AS (
        UPDATE categorization_job_passes p SET status = 'abandoned', finished_at = now()
        WHERE p.job_id IN (SELECT id FROM locked) AND p.status = 'running' RETURNING id
      )
      UPDATE categorization_jobs SET counts_exact = counts_exact AND NOT EXISTS (SELECT 1 FROM abandoned),
        status = CASE WHEN status <> 'running' THEN status WHEN control_action = 'cancel' THEN 'cancelled'
          WHEN control_action = 'pause' THEN 'paused' ELSE 'queued' END,
        pause_reason = CASE WHEN control_action = 'pause' THEN 'user_paused' ELSE pause_reason END,
        finished_at = CASE WHEN control_action = 'cancel' THEN now() ELSE finished_at END,
        lease_token = NULL, lease_expires_at = NULL, updated_at = now()
      WHERE id IN (SELECT id FROM locked) RETURNING *
    `);
    return fromRow(result.rows[0]);
  },

  async failPass(id: string, token: string, passId: string): Promise<void> {
    await getDb().execute(sql`
      WITH locked AS MATERIALIZED (
        SELECT id FROM categorization_jobs WHERE id = ${id}::uuid AND lease_token = ${token}::uuid FOR UPDATE
      ), failed AS (
        UPDATE categorization_job_passes p SET status = 'failed', finished_at = now()
        WHERE p.id = ${passId}::uuid AND p.job_id IN (SELECT id FROM locked) AND p.status = 'running' RETURNING id
      )
      UPDATE categorization_jobs SET counts_exact = FALSE,
        status = CASE WHEN control_action = 'cancel' THEN 'cancelled' ELSE 'paused' END,
        pause_reason = CASE WHEN control_action = 'pause' THEN 'user_paused' ELSE 'processing_failed' END,
        updated_at = now() WHERE id IN (SELECT id FROM locked) AND EXISTS (SELECT 1 FROM failed)
    `);
  },

  async control(id: string, action: 'pause' | 'cancel' | 'resume'): Promise<StoredCategorizationJob | null> {
    const result = action === 'resume' ? await getDb().execute(sql`
      UPDATE categorization_jobs SET status = 'queued', control_action = NULL, pause_reason = NULL,
        dispatch_issue = NULL, lease_token = NULL, lease_expires_at = NULL,
        pass_limit = CASE WHEN passes >= pass_limit THEN passes + ${MAX_JOB_PASSES} ELSE pass_limit END, finished_at = NULL, updated_at = now()
      WHERE id = ${id}::uuid AND status = 'paused' RETURNING *
    `) : await getDb().execute(sql`
      UPDATE categorization_jobs SET
        control_action = ${action}, status = CASE WHEN status = 'running' THEN status WHEN ${action} = 'pause' THEN 'paused' ELSE 'cancelled' END,
        pause_reason = CASE WHEN status = 'running' THEN pause_reason WHEN ${action} = 'pause' THEN 'user_paused' ELSE NULL END,
        finished_at = CASE WHEN status <> 'running' AND ${action} = 'cancel' THEN now() ELSE finished_at END, updated_at = now()
      WHERE id = ${id}::uuid AND status IN ('queued', 'running', 'paused') RETURNING *
    `);
    return fromRow(result.rows[0]) ?? this.get(id);
  },

  async recordDispatch(id: string, accepted: boolean, issue: string | null): Promise<void> {
    await getDb().execute(sql`UPDATE categorization_jobs SET dispatch_issue = ${accepted ? null : issue},
      updated_at = CASE WHEN status = 'queued' OR (status = 'running' AND lease_expires_at <= now()) THEN now() ELSE updated_at END
      WHERE id = ${id}::uuid AND status IN ('queued', 'running')`);
  },
};
