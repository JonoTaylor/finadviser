#!/usr/bin/env node
/**
 * Apply src/lib/db/migration.sql against DATABASE_URL.
 *
 * Runs as part of the Vercel build (see package.json "build" script) so the
 * deployed app is never out of sync with the schema it expects.
 *
 * Atomicity: the whole file is wrapped in BEGIN / COMMIT, with ROLLBACK on
 * error, so a partial migration can never leave the DB half-applied.
 *
 * Idempotency: every statement in migration.sql uses IF NOT EXISTS / ON
 * CONFLICT DO UPDATE / CREATE OR REPLACE, so running on every deploy is
 * safe — no migration history table needed for the workload at this stage.
 *
 * Escape hatches:
 *   SKIP_DB_MIGRATIONS=true   — skip without failing the build (emergency)
 *   DATABASE_URL not set      — skip with a warning, don't fail the build
 *                                (e.g. local builds without secrets)
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Client, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION_PATH = resolve(__dirname, '..', 'src', 'lib', 'db', 'migration.sql');

async function main() {
  if (process.env.SKIP_DB_MIGRATIONS === 'true') {
    console.log('[migrate] SKIP_DB_MIGRATIONS=true — skipping');
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.warn('[migrate] DATABASE_URL not set — skipping (set it in Vercel env to enable)');
    return;
  }

  const sql = await readFile(MIGRATION_PATH, 'utf-8');

  // Neon's Client uses websockets, which is what we need for multi-statement
  // queries and DO $$ ... $$ bodies (the HTTP transport can't run those).
  neonConfig.webSocketConstructor = ws;

  // A single Client (not a Pool) for a one-shot script: lighter, and it
  // guarantees every statement in the transaction runs on the same
  // connection.
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const start = Date.now();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log(`[migrate] applied migration.sql in ${Date.now() - start}ms`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => { /* swallow rollback errors */ });
    throw err;
  } finally {
    await client.end();
  }
}

main().catch(err => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
