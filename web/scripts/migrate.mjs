#!/usr/bin/env node
/**
 * Apply src/lib/db/migration.sql against DATABASE_URL.
 *
 * Runs as part of the Vercel build (see package.json "build" script) so the
 * deployed app is never out of sync with the schema it expects.
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
import { Pool, neonConfig } from '@neondatabase/serverless';
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

  // Neon's serverless Pool uses websockets for multi-statement queries, which
  // we need here because migration.sql contains DO $$ ... $$ blocks and
  // multiple statements that node-postgres' HTTP transport can't run together.
  neonConfig.webSocketConstructor = ws;

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const start = Date.now();
  try {
    await pool.query(sql);
    console.log(`[migrate] applied migration.sql in ${Date.now() - start}ms`);
  } finally {
    await pool.end();
  }
}

main().catch(err => {
  console.error('[migrate] failed:', err);
  process.exit(1);
});
