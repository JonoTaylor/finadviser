import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { appSettingsRepo } from '@/lib/repos/app-settings.repo';

export interface WorkspaceEnvelope<T> {
  version: 1;
  revision: number;
  updatedAt: string | null;
  data: T;
}

export class WorkspaceConflictError extends Error {
  constructor() {
    super('This workspace changed in another tab. Reload the latest saved version before saving again. Your entries have not been written.');
    this.name = 'WorkspaceConflictError';
  }
}

export class WorkspaceStoredDataError extends Error {
  constructor() {
    super('The saved workspace needs review before it can be used. No replacement data has been saved.');
    this.name = 'WorkspaceStoredDataError';
  }
}

const revisionSchema = z.number().int().min(0).max(1_000_000_000);
const envelopeSchema = z.object({
  version: z.literal(1),
  revision: revisionSchema,
  updatedAt: z.iso.datetime().nullable(),
  data: z.unknown(),
}).strict();

function parseStored<T>(value: string, schema: z.ZodType<T>): WorkspaceEnvelope<T> {
  try {
    const envelope = envelopeSchema.parse(JSON.parse(value));
    if (envelope.revision < 1 || envelope.updatedAt === null) throw new WorkspaceStoredDataError();
    return { ...envelope, data: schema.parse(envelope.data) };
  } catch {
    throw new WorkspaceStoredDataError();
  }
}

/** New namespaces only: this does not replace legacy planning/pension settings. */
export async function readWorkspace<T>(key: string, schema: z.ZodType<T>, initial: T): Promise<WorkspaceEnvelope<T>> {
  const stored = await appSettingsRepo.get(key);
  if (stored === null) return { version: 1, revision: 0, updatedAt: null, data: schema.parse(initial) };
  return parseStored(stored, schema);
}

/** Atomic compare-and-swap prevents a stale tab from overwriting newer facts. */
export async function writeWorkspace<T>(
  key: string,
  schema: z.ZodType<T>,
  data: unknown,
  expectedRevision: number,
): Promise<WorkspaceEnvelope<T>> {
  const revision = revisionSchema.max(999_999_999).parse(expectedRevision);
  const validated = schema.parse(data);
  const existing = await appSettingsRepo.get(key);
  if (existing !== null && parseStored(existing, schema).revision !== revision) throw new WorkspaceConflictError();
  if (existing === null && revision !== 0) throw new WorkspaceConflictError();
  const envelope: WorkspaceEnvelope<T> = {
    version: 1, revision: revision + 1, updatedAt: new Date().toISOString(), data: validated,
  };
  const value = JSON.stringify(envelope);
  const result = await getDb().execute(sql`
    INSERT INTO app_settings (key, value)
    SELECT ${key}, ${value}
    WHERE ${revision} = 0 OR EXISTS (
      SELECT 1 FROM app_settings prior
      WHERE prior.key = ${key}
        AND prior.value::jsonb ->> 'version' = '1'
        AND prior.value::jsonb ->> 'revision' = ${String(revision)}
    )
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
    WHERE app_settings.value::jsonb ->> 'version' = '1'
      AND app_settings.value::jsonb ->> 'revision' = ${String(revision)}
    RETURNING value
  `);
  if (result.rows.length !== 1) throw new WorkspaceConflictError();
  return parseStored(String(result.rows[0].value), schema);
}
