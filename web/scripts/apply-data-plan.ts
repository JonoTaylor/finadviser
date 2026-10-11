/**
 * Safe, idempotent data loader.
 *
 * Reads a JSON "data plan" (see src/lib/data-plan/schema.ts and
 * scripts/data-plan.example.json), compares it with the database and either
 * prints what it would change (default), prints the current state
 * (--snapshot) or makes the changes (--apply).
 *
 *   DATABASE_URL=postgres://... npm run data-plan:check -- --plan plan.json --snapshot
 *   DATABASE_URL=postgres://... npm run data-plan:check -- --plan plan.json            # dry run
 *   DATABASE_URL=postgres://... npm run data-plan:apply -- --plan plan.json            # writes
 *
 * From a sandbox whose only way out is an HTTPS CONNECT proxy (HTTPS_PROXY)
 * that refuses WebSocket upgrades, use the HTTP driver: plain HTTPS to port
 * 443, tunnelled through the proxy by the loader itself (it does not depend
 * on Node's NODE_USE_ENV_PROXY=1, though that is harmless if set; trust the
 * proxy's CA with NODE_EXTRA_CA_CERTS, as for any tool).
 *
 *   npm run data-plan:check -- --driver http --plan plan.json --account alias="Exact Name"
 *   npm run data-plan:apply -- --driver http --plan plan.json --account alias="Exact Name" --expect-digest <from the dry run>
 *
 * Options
 *   --plan <file>           plan JSON (required)
 *   --snapshot              print the current database state relevant to the plan, then stop
 *   --apply                 make the changes (default is a read-only dry run)
 *   --account alias=Name    set/override a plan account alias (repeatable)
 *   --expect-digest <hex>   with --apply: refuse unless the change set matches the dry run's digest
 *                           (REQUIRED with --driver http)
 *   --driver auto|pg|neon|http
 *                           auto (default) = pg for localhost/127.0.0.1, the Neon WebSocket client
 *                           otherwise; http = Neon HTTP API (no WebSocket). When --driver is not
 *                           given, the environment variable DATA_PLAN_DRIVER (same values) picks it.
 *
 * Run it from the web/ directory (tsx resolves the '@/' import alias from the
 * tsconfig.json in the working directory); the npm scripts already do.
 *
 * Schema not migrated yet: production may not have src/lib/db/migration.sql's
 * latest changes (properties.letting_type, owner_tax_profiles) until the next
 * deploy. --snapshot and the dry run still work then: they say "schema not
 * migrated yet", list the letting-type and tax-profile items as "pending
 * migration: would apply after `npm run db:migrate` or the next deploy" and
 * plan everything else normally (the totals do not depend on those items).
 * --apply refuses until the schema is present.
 *
 * Safety properties
 *   - dry run and snapshot run inside a READ ONLY transaction: they cannot write
 *   - the loader only INSERTs and UPDATEs; it never deletes anything
 *   - pg / neon: --apply is one interactive transaction (BEGIN/COMMIT, ROLLBACK
 *     on any error) under an advisory lock, re-checks its own result before
 *     COMMIT, and a second --apply changes nothing
 *   - http: the API cannot hold a transaction open, so --apply plans from one
 *     consistent read batch, checks --expect-digest, then sends ALL writes as
 *     ONE atomic batch. Every write guards itself in SQL (journals only if
 *     their reference is absent, updates only if the columns still hold what
 *     the plan saw, tagging only if still untagged) and the batch ends with a
 *     check that makes Postgres roll everything back if any guard did not
 *     fire as expected (see src/lib/data-plan/http-statements.ts). After the
 *     commit it re-reads and re-plans, and shouts if anything is left over.
 *   - every journal it creates carries reference 'plan:<planId>:<itemId>'
 *
 * Exit codes: 0 ok, 1 unexpected error (or a failed post-commit verification),
 * 2 refused (preconditions: schema, owner/property, digest, lost race),
 * 3 not ready to apply (dry run: blocked items, or schema not migrated yet),
 * 4 bad usage or invalid plan.
 */

import { readFile } from 'node:fs/promises';
import { connect, parseDatabaseUrl, redactSecrets, resolveDriverChoice, type ConnectionInfo, type DbConnection, type DriverChoice } from '../src/lib/data-plan/connect';
import { evaluatePlan, type Evaluation } from '../src/lib/data-plan/evaluate';
import { changeDigest, renderChange, renderPlanResult, renderSchemaNotice, renderSnapshot, renderTotals, renderTotalsComparison } from '../src/lib/data-plan/format';
import { connectHttp, type HttpDb } from '../src/lib/data-plan/http';
import { buildWriteBatch, classifyWriteFailure, LOADER_LOCK_KEY, MAX_BATCH_BYTES, raceDetail } from '../src/lib/data-plan/http-statements';
import { planChanges } from '../src/lib/data-plan/planner';
import { parsePlan, PlanValidationError, type Plan } from '../src/lib/data-plan/schema';
import {
  assembleState,
  buildStateQueries,
  checkSchema,
  evaluateSchema,
  loadState,
  schemaColumnsQuery,
  schemaReady,
  type SchemaReport,
  type StateQueryKey,
} from '../src/lib/data-plan/state';
import { applyChange, orderForApply } from '../src/lib/data-plan/statements';
import { computeOwnerTotals, resolveAllocationPct, totalsEqual } from '../src/lib/data-plan/totals';
import type { DbState } from '../src/lib/data-plan/types';

class Exit extends Error {
  constructor(readonly code: number, message?: string) {
    super(message);
  }
}

interface Args {
  planPath: string;
  snapshot: boolean;
  apply: boolean;
  accounts: Record<string, string>;
  driver: DriverChoice;
  expectDigest: string | null;
}

function usage(): string {
  return [
    'Usage: tsx scripts/apply-data-plan.ts --plan <plan.json> [--snapshot | --apply] [options]',
    '',
    '  --plan <file>          plan JSON (required)',
    '  --snapshot             print the current database state relevant to the plan',
    '  --apply                make the changes (default: read-only dry run)',
    '  --account alias=Name   set or override a plan account alias (repeatable)',
    '  --expect-digest <hex>  with --apply: refuse unless the changes match this dry-run digest',
    '                         (required with --driver http)',
    '  --driver auto|pg|neon|http',
    '                         database driver (default auto; DATA_PLAN_DRIVER sets it when the flag is absent)',
    '                           auto  pg for localhost, the Neon WebSocket client otherwise',
    '                           pg    plain Postgres connection',
    '                           neon  Neon WebSocket client (needs WebSocket upgrades to work)',
    '                           http  Neon HTTP API: plain HTTPS to port 443, through HTTPS_PROXY when set;',
    '                                 apply sends all writes as one atomic, self-guarding batch',
    '',
    'DATABASE_URL must be set in the environment.',
    '',
    'From a sandbox that only allows HTTPS through a proxy (no WebSocket):',
    '  npm run data-plan:check -- --driver http --plan plan.json --account alias="Exact Name"',
    '  npm run data-plan:apply -- --driver http --plan plan.json --account alias="Exact Name" --expect-digest <digest from the dry run>',
    '  (or set DATA_PLAN_DRIVER=http and drop --driver. The loader tunnels its own requests through HTTPS_PROXY,',
    '   so NODE_USE_ENV_PROXY=1 is optional.)',
    '',
    'Exit codes: 0 ok, 1 unexpected error, 2 refused, 3 not ready to apply (dry run), 4 bad usage or invalid plan.',
  ].join('\n');
}

const DIGEST_RE = /^[0-9a-f]{8,16}$/;

function parseArgs(argv: string[], env: NodeJS.ProcessEnv = process.env): Args {
  let driverFlag: string | null = null;
  const args: Args = { planPath: '', snapshot: false, apply: false, accounts: {}, driver: 'auto', expectDigest: null };
  const takeValue = (i: number, flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Exit(4, `${flag} needs a value\n\n${usage()}`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--plan':
        args.planPath = takeValue(i++, a);
        break;
      case '--snapshot':
        args.snapshot = true;
        break;
      case '--apply':
        args.apply = true;
        break;
      case '--account': {
        const v = takeValue(i++, a);
        const eq = v.indexOf('=');
        if (eq < 1 || eq === v.length - 1) throw new Exit(4, `--account expects alias=Exact account name (got "${v}")`);
        args.accounts[v.slice(0, eq)] = v.slice(eq + 1);
        break;
      }
      case '--driver':
        driverFlag = takeValue(i++, a);
        break;
      case '--expect-digest':
        args.expectDigest = takeValue(i++, a).toLowerCase();
        break;
      case '--help':
      case '-h':
        console.log(usage());
        throw new Exit(0);
      default:
        throw new Exit(4, `Unknown argument "${a}"\n\n${usage()}`);
    }
  }
  try {
    args.driver = resolveDriverChoice(driverFlag, env);
  } catch (err) {
    throw new Exit(4, err instanceof Error ? err.message : String(err));
  }
  if (!args.planPath) throw new Exit(4, `--plan is required\n\n${usage()}`);
  if (args.snapshot && args.apply) throw new Exit(4, '--snapshot and --apply cannot be combined');
  if (args.expectDigest && !args.apply) throw new Exit(4, '--expect-digest only makes sense with --apply');
  if (args.expectDigest && !DIGEST_RE.test(args.expectDigest)) {
    throw new Exit(4, `--expect-digest must be 8 to 16 hex characters, copied from the dry run's "Change digest:" line (got "${args.expectDigest}")`);
  }
  if (args.driver === 'http' && args.apply && !args.expectDigest) {
    throw new Exit(
      4,
      [
        '--driver http --apply requires --expect-digest.',
        'The HTTP API cannot hold a transaction open, so the loader plans from one read and then writes in a second request.',
        'The digest from a dry run you have reviewed is what ties the two together: run the dry run, read it, then pass its "Change digest".',
      ].join('\n'),
    );
  }
  return args;
}

async function readPlan(path: string, accountOverrides: Record<string, string>): Promise<Plan> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch (err) {
    throw new Exit(4, `Cannot read plan file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (err) {
    throw new Exit(4, `Plan file ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  let plan: Plan;
  try {
    plan = parsePlan(json);
  } catch (err) {
    if (err instanceof PlanValidationError) throw new Exit(4, err.message);
    throw err;
  }
  for (const [alias, name] of Object.entries(accountOverrides)) {
    if (!(alias in plan.accounts)) {
      throw new Exit(4, `--account ${alias}: the plan defines no such alias (aliases: ${Object.keys(plan.accounts).join(', ') || 'none'})`);
    }
    plan.accounts[alias] = name;
  }
  return plan;
}

// ---------------------------------------------------------------------------
// reading: schema + state, however the driver does it
// ---------------------------------------------------------------------------

/** What a read found. `state` is null when the schema has problems no migration explains. */
interface Loaded {
  schema: SchemaReport;
  state: DbState | null;
}

type Reader = () => Promise<Loaded>;

/** Schema check, then the state, on a connection that is already in a transaction. */
async function loadWithin(db: DbConnection, plan: Plan): Promise<Loaded> {
  const schema = await checkSchema(db);
  if (schema.blocking.length > 0) return { schema, state: null };
  return { schema, state: await loadState(db, plan, schema) };
}

async function inReadOnlyTransaction<T>(db: DbConnection, fn: () => Promise<T>): Promise<T> {
  // REPEATABLE READ: every query in the snapshot sees one consistent moment, even if a bank sync lands meanwhile.
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await fn();
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
  }
}

function transactionReader(db: DbConnection, plan: Plan): Reader {
  return () => inReadOnlyTransaction(db, () => loadWithin(db, plan));
}

/**
 * HTTP read: one request for the schema, then ONE read-only REPEATABLE READ
 * batch holding every state query, so all of the state is one snapshot. The
 * state queries do not depend on each other (see buildStateQueries), which is
 * what makes a single batch possible. Only the schema check is a separate
 * request, because which queries to send depends on it; the schema cannot
 * change between the two unless a migration runs in that instant, in which
 * case the worst outcome is a loud query error or an item reported as pending
 * that no longer is, so consistency across those two requests is best-effort.
 */
function httpReader(http: HttpDb, plan: Plan, url: string): Reader {
  return async () => {
    try {
      const { text, params } = schemaColumnsQuery();
      const schema = evaluateSchema((await http.query(text, params)) as Array<{ table_name: string; column_name: string }>);
      if (schema.blocking.length > 0) return { schema, state: null };
      const queries = buildStateQueries(plan, schema);
      const results = await http.readBatch(queries);
      const byKey: Partial<Record<StateQueryKey, Record<string, unknown>[]>> = {};
      queries.forEach((q, i) => {
        byKey[q.key] = results[i];
      });
      return { schema, state: assembleState(plan, schema, byKey) };
    } catch (err) {
      const text = redactSecrets(err instanceof Error ? err.message : String(err), url);
      // A SQLSTATE means Postgres answered (bad password, permission, ...); otherwise the message is already the transport explanation.
      const code = (err as { code?: unknown } | null)?.code;
      throw new Exit(1, typeof code === 'string' ? `The database rejected the read (SQLSTATE ${code}): ${text}` : text);
    }
  };
}

// ---------------------------------------------------------------------------
// printing
// ---------------------------------------------------------------------------

function schemaRefusal(report: SchemaReport): string {
  const problems = [...report.blocking, ...report.pendingMigration];
  const needsMigrate = report.pendingMigration.length > 0;
  return [
    needsMigrate && report.blocking.length === 0
      ? 'The database schema is not migrated yet, so --apply refuses (a dry run and --snapshot still work):'
      : 'The database schema is not ready for this loader:',
    ...problems.map(p => `  - ${p}`),
    '',
    needsMigrate
      ? 'Run "npm run db:migrate" (it applies src/lib/db/migration.sql; the next deploy does the same) against this database first, then re-run.'
      : 'Run "npm run db:migrate" against this database first; if that does not fix it the database is not an app database.',
  ].join('\n');
}

function printRefusals(refusals: string[]): void {
  console.log('\n== REFUSED: nothing was changed ==');
  for (const r of refusals) console.log(`  - ${r}`);
}

function printPreconditions(plan: Plan, state: DbState): void {
  const owner = state.owners.find(o => o.name === plan.owner);
  if (!owner) return;
  const pending = state.pendingMigration;
  console.log(pending ? '\n== Preconditions (passed, apart from the schema) ==' : '\n== Preconditions (all passed) ==');
  if (pending) {
    const missing = [pending.lettingType ? 'properties.letting_type' : '', pending.taxProfile ? 'owner_tax_profiles' : ''].filter(Boolean);
    console.log(`  schema: NOT MIGRATED YET (${missing.join(', ')}): dry run only, --apply refuses`);
  } else {
    console.log('  schema: properties.letting_type and owner_tax_profiles are present');
  }
  console.log(`  owner "${owner.name}" exists (#${owner.id})`);
  for (const section of plan.properties) {
    const p = state.properties.find(x => x.name === section.name)!;
    const share = resolveAllocationPct(p.id, owner.id, state.allocationRules, state.ownership).toFixed(4);
    const letting = pending?.lettingType ? 'letting_type not migrated yet' : `letting_type=${p.lettingType}`;
    console.log(`  property "${p.name}" exists (#${p.id}, ${letting}); owner's share ${share}%`);
  }
}

function printEvaluation(plan: Plan, ev: Evaluation, heading: string): void {
  printPreconditions(plan, ev.state);
  console.log(`\n${renderPlanResult(ev.result, heading)}`);
  if (ev.before && ev.after) console.log(`\n${renderTotalsComparison(ev.before, ev.after, 'After (predicted)')}`);
}

function describeChanges(n: number): string {
  return `${n} change${n === 1 ? '' : 's'}`;
}

/** Shell-safe rendering of a command-line value, for the hint that repeats the dry run's options. */
function shellQuote(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

function applyHint(args: Args, digest: string): string {
  const parts = ['npm run data-plan:apply --', ...(args.driver === 'auto' ? [] : [`--driver ${args.driver}`]), `--plan ${shellQuote(args.planPath)}`];
  for (const [alias, name] of Object.entries(args.accounts)) parts.push(`--account ${shellQuote(`${alias}=${name}`)}`);
  parts.push(`--expect-digest ${digest}`);
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// snapshot and dry run (all drivers)
// ---------------------------------------------------------------------------

async function runSnapshot(read: Reader, plan: Plan): Promise<number> {
  const loaded = await read();
  if (!loaded.state) {
    console.log(`\n${schemaRefusal(loaded.schema)}`);
    return 2;
  }
  const state = loaded.state;
  if (loaded.schema.pendingMigration.length > 0) console.log(`\n${renderSchemaNotice(loaded.schema)}`);
  console.log(`\n${renderSnapshot(plan, state)}`);
  const refusals = planChanges(plan, state).refusals;
  if (refusals.length > 0) {
    printRefusals(refusals);
    return 2;
  }
  const owner = state.owners.find(o => o.name === plan.owner)!;
  const totals = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state });
  console.log(`\n${renderTotals(totals)}`);
  return 0;
}

async function runDryRun(read: Reader, plan: Plan, args: Args): Promise<number> {
  const loaded = await read();
  if (!loaded.state) {
    console.log(`\n${schemaRefusal(loaded.schema)}`);
    return 2;
  }
  const migrationPending = loaded.schema.pendingMigration.length > 0;
  if (migrationPending) console.log(`\n${renderSchemaNotice(loaded.schema)}`);

  const ev = evaluatePlan(plan, loaded.state);
  if (ev.result.refusals.length > 0) {
    printRefusals(ev.result.refusals);
    return 2;
  }
  printEvaluation(plan, ev, 'Changes it WOULD make');
  const count = ev.result.changes.length;
  if (migrationPending) {
    // The digest of a partial change set must not be mistaken for the one to apply with.
    console.log(`\nChanges planned so far: ${describeChanges(count)} (no digest: the change set is incomplete until the schema is migrated).`);
  } else {
    console.log(`\nChange digest: ${changeDigest(ev.result.changes)}  (${describeChanges(count)})`);
  }
  if (ev.result.blocked.length > 0) {
    console.log(`\nNOT READY: ${ev.result.blocked.length} included item(s) are blocked. --apply would refuse. Fix the plan or pass --account, then dry-run again.`);
    return 3;
  }
  if (migrationPending) {
    console.log(
      '\nNOT READY TO APPLY: the schema is not migrated yet. --apply refuses until it is.\n' +
        'Run `npm run db:migrate` (or let the next deploy do it), then dry-run again: that run\'s digest is the one to pass to --apply.',
    );
    return 3;
  }
  console.log(
    count === 0
      ? '\nNothing to do: the database already matches the plan.'
      : `\nTo apply exactly these changes: ${applyHint(args, changeDigest(ev.result.changes))}`,
  );
  return 0;
}

// ---------------------------------------------------------------------------
// apply over an interactive connection (pg / Neon WebSocket)
// ---------------------------------------------------------------------------

async function printAfterState(plan: Plan, state: DbState, beforeTotals: Evaluation['before']): Promise<void> {
  console.log(`\n== After-state (re-read) ==\n${renderSnapshot(plan, state)}`);
  const owner = state.owners.find(o => o.name === plan.owner)!;
  const after = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state });
  if (beforeTotals) console.log(`\n${renderTotalsComparison(beforeTotals, after, 'After (re-read)')}`);
  const rerun = planChanges(plan, state);
  console.log(
    rerun.changes.length === 0
      ? '\nIdempotency check: re-planning against the committed state finds 0 changes.'
      : `\nWARNING: re-planning against the committed state still finds ${rerun.changes.length} change(s).`,
  );
}

async function runApply(db: DbConnection, plan: Plan, expectDigest: string | null): Promise<number> {
  console.log('\nAPPLY: one transaction, rolled back on any error.');
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  let open = true;
  let before: Evaluation['before'] = null;
  let changeCount = 0;
  try {
    await db.query('SET LOCAL statement_timeout = 120000');
    await db.query('SET LOCAL lock_timeout = 15000');
    const lock = await db.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [LOADER_LOCK_KEY]);
    if (!lock.rows[0]?.locked) throw new Exit(2, 'Another data-plan run holds the loader lock. Wait for it to finish and re-run.');

    const loaded = await loadWithin(db, plan);
    if (!loaded.state || !schemaReady(loaded.schema)) throw new Exit(2, schemaRefusal(loaded.schema));

    const ev = evaluatePlan(plan, loaded.state);
    if (ev.result.refusals.length > 0) {
      printRefusals(ev.result.refusals);
      throw new Exit(2);
    }
    printEvaluation(plan, ev, 'Changes to make');
    const digest = changeDigest(ev.result.changes);
    console.log(`\nChange digest: ${digest}  (${describeChanges(ev.result.changes.length)})`);

    if (ev.result.blocked.length > 0) {
      throw new Exit(3, `${ev.result.blocked.length} included item(s) are blocked (see above). Nothing was applied.`);
    }
    if (expectDigest && !digest.startsWith(expectDigest)) {
      throw new Exit(2, `The changes no longer match the reviewed dry run (expected digest ${expectDigest}, now ${digest}). The database or the plan changed in between. Nothing was applied; dry-run again.`);
    }
    if (ev.result.changes.length === 0) {
      console.log('\nNothing to change: the database already matches the plan. No write transaction needed.');
      await db.query('ROLLBACK');
      open = false;
      return 0;
    }

    before = ev.before;
    changeCount = ev.result.changes.length;
    console.log('\n== Writing (inside the transaction; nothing is final until COMMIT) ==');
    for (const change of orderForApply(ev.result.changes)) {
      await applyChange(db, change);
      console.log(`  staged   ${renderChange(change).split('\n')[0]}`);
    }

    // Self-checks before COMMIT: the database must now match the plan
    // (a second pass finds nothing to do) and the owner totals must be what
    // the dry run predicted.
    const recheckLoaded = await loadWithin(db, plan);
    if (!recheckLoaded.state) throw new Error(`Post-apply check failed: the schema became unusable.\n${schemaRefusal(recheckLoaded.schema)}`);
    const recheck = evaluatePlan(plan, recheckLoaded.state);
    if (recheck.result.changes.length > 0 || recheck.result.blocked.length > 0) {
      throw new Error(
        `Post-apply check failed: a second pass still wants ${recheck.result.changes.length} change(s) / ${recheck.result.blocked.length} blocked. Rolling back.\n${renderPlanResult(recheck.result)}`,
      );
    }
    if (!recheck.before || !ev.after || !totalsEqual(recheck.before.combined, ev.after.combined)) {
      throw new Error(
        `Post-apply check failed: owner totals after the writes (${JSON.stringify(recheck.before?.combined)}) differ from the dry-run prediction (${JSON.stringify(ev.after?.combined)}). Rolling back.`,
      );
    }
    console.log('\nPost-apply checks passed: a second pass finds nothing to do, and the totals match the prediction.');

    await db.query('COMMIT');
    open = false;
  } catch (err) {
    if (open) await db.query('ROLLBACK').catch(() => undefined);
    throw err;
  }

  // Re-read from the committed database and print the after-state.
  console.log(`\nCOMMITTED ${describeChanges(changeCount)}. Re-reading from the database...`);
  await inReadOnlyTransaction(db, async () => {
    const loaded = await loadWithin(db, plan);
    if (loaded.state) await printAfterState(plan, loaded.state, before);
  });
  return 0;
}

// ---------------------------------------------------------------------------
// apply over the Neon HTTP API: plan from a read, one atomic self-guarding write batch
// ---------------------------------------------------------------------------

function loudBanner(title: string): string {
  const bar = '!'.repeat(78);
  return `\n${bar}\n!! ${title}\n${bar}`;
}

async function runApplyHttp(http: HttpDb, plan: Plan, expectDigest: string, url: string): Promise<number> {
  console.log('\nAPPLY (http): plan from one consistent read, then ALL writes in ONE atomic batch (all or nothing).');
  const read = httpReader(http, plan, url);

  // 1. Plan from a read batch.
  const loaded = await read();
  if (!loaded.state || !schemaReady(loaded.schema)) throw new Exit(2, schemaRefusal(loaded.schema));
  const ev = evaluatePlan(plan, loaded.state);
  if (ev.result.refusals.length > 0) {
    printRefusals(ev.result.refusals);
    throw new Exit(2);
  }
  printEvaluation(plan, ev, 'Changes to make');
  const digest = changeDigest(ev.result.changes);
  console.log(`\nChange digest: ${digest}  (${describeChanges(ev.result.changes.length)})`);

  if (ev.result.blocked.length > 0) {
    throw new Exit(3, `${ev.result.blocked.length} included item(s) are blocked (see above). Nothing was applied.`);
  }
  // 2. The digest of the dry run you reviewed must be the digest of what we are about to write.
  if (!digest.startsWith(expectDigest)) {
    throw new Exit(2, `The changes no longer match the reviewed dry run (expected digest ${expectDigest}, now ${digest}). The database or the plan changed in between. Nothing was applied; dry-run again.`);
  }
  if (ev.result.changes.length === 0) {
    console.log('\nNothing to change: the database already matches the plan. No write batch needed.');
    return 0;
  }

  // 3. One batch: lock, setup, a guarded write per change, race check.
  const batch = buildWriteBatch(ev.result.changes, { lockKey: LOADER_LOCK_KEY });
  if (batch.approxBytes > MAX_BATCH_BYTES) {
    throw new Exit(2, `The write batch would be about ${Math.round(batch.approxBytes / 1e6)} MB, over the ${MAX_BATCH_BYTES / 1e6} MB limit the loader allows for one request. Split the plan into smaller plans.`);
  }
  console.log(`\n== Sending ONE transaction: ${batch.writeCount} guarded write${batch.writeCount === 1 ? '' : 's'} (expecting ${batch.expectedTouched} row${batch.expectedTouched === 1 ? '' : 's'} touched), between a lock and a race check ==`);
  for (const s of batch.statements.filter(x => x.change)) console.log(`  queued   ${renderChange(s.change!).split('\n')[0]}`);

  let results: Record<string, unknown>[][];
  try {
    results = await http.writeBatch(batch.statements);
  } catch (err) {
    return handleWriteFailure(err, { http, plan, url, digest, changeCount: ev.result.changes.length, read });
  }
  const touched = Number(results[results.length - 1]?.[0]?.touched);
  console.log(`\nCOMMITTED ${describeChanges(ev.result.changes.length)}: the race check passed (${touched} guarded rows touched, ${batch.expectedTouched} expected). Re-reading from the database...`);

  // 4. Re-read, re-plan: nothing may be left and the totals must be the prediction. Too late to roll back.
  let after: Loaded;
  try {
    after = await read();
  } catch (err) {
    console.log(loudBanner('COMMITTED, BUT THE VERIFICATION READ FAILED'));
    console.log(`The write batch committed, but re-reading to verify it failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log('Run the dry run again when the connection is back: it should report "Nothing to do".');
    return 1;
  }
  if (!after.state) {
    console.log(loudBanner('COMMITTED, BUT THE VERIFICATION READ FOUND AN UNUSABLE SCHEMA'));
    console.log(schemaRefusal(after.schema));
    return 1;
  }
  const ev2 = evaluatePlan(plan, after.state);
  await printAfterState(plan, after.state, ev.before);
  const problems: string[] = [];
  if (ev2.result.changes.length > 0 || ev2.result.blocked.length > 0) {
    const detail = [
      ...ev2.result.changes.map(c => renderChange(c).split('\n').map(l => `      ${l}`).join('\n')),
      ...ev2.result.blocked.map(b => `      [!] blocked ${b.itemId}: ${b.reason}`),
    ].join('\n');
    problems.push(`re-planning against the committed data still wants ${ev2.result.changes.length} change(s) and finds ${ev2.result.blocked.length} blocked item(s):\n${detail}`);
  }
  if (!ev2.before || !ev.after || !totalsEqual(ev2.before.combined, ev.after.combined)) {
    problems.push(`the owner's totals after the commit (${JSON.stringify(ev2.before?.combined)}) differ from the dry-run prediction (${JSON.stringify(ev.after?.combined)})`);
  }
  if (problems.length > 0) {
    console.log(loudBanner('POST-COMMIT VERIFICATION FAILED: THE DATABASE DOES NOT MATCH THE PREDICTION'));
    console.log('The write batch COMMITTED, so it cannot be rolled back automatically, and what is in the database is not what the dry run predicted:');
    for (const p of problems) console.log(`  - ${p}`);
    console.log('Take a --snapshot and a dry run now and compare them with the dry run you reviewed: the dry run lists exactly what the loader would still do. Work out what changed the data before applying anything else.');
    return 1;
  }
  console.log('\nPost-commit verification passed: re-planning against the committed data finds nothing to do, and the totals equal the prediction.');
  return 0;
}

async function handleWriteFailure(
  err: unknown,
  ctx: { http: HttpDb; plan: Plan; url: string; digest: string; changeCount: number; read: Reader },
): Promise<number> {
  const failure = classifyWriteFailure(err);
  const message = redactSecrets(failure.message, ctx.url);
  if (failure.kind === 'rolled_back') {
    if (failure.lockHeld) {
      throw new Exit(2, 'Another data-plan run holds the loader lock, so the write batch was rolled back. NOTHING was committed. Wait for it to finish, then dry-run and re-apply.');
    }
    if (failure.raceLost) {
      throw new Exit(
        2,
        [
          'LOST A RACE: the write batch was rolled back. NOTHING was committed.',
          `  ${raceDetail(message)}`,
          'Someone (or something, such as a bank sync) changed the data between the read and the write. Dry-run again, review, and re-apply with the new digest.',
        ].join('\n'),
      );
    }
    throw new Exit(1, `The database rejected the write batch (SQLSTATE ${failure.code}): ${message}\nThe batch was rolled back: NOTHING was committed.`);
  }

  console.log(loudBanner('THE WRITE REQUEST FAILED WITHOUT A DATABASE ANSWER: OUTCOME UNKNOWN'));
  console.log(message);
  console.log('The batch is atomic, so it either committed completely or not at all. Checking by reading the database back...');
  try {
    const after = await ctx.read();
    if (!after.state) throw new Error('the schema looks unusable');
    const ev = evaluatePlan(ctx.plan, after.state);
    if (ev.result.changes.length === 0 && ev.result.blocked.length === 0) {
      console.log('\nRE-READ: nothing is left to do. The batch DID commit (only its response was lost). The data is in place; re-run the dry run to confirm.');
    } else if (changeDigest(ev.result.changes) === ctx.digest) {
      console.log('\nRE-READ: the same changes are still wanted. The batch did NOT commit (yet). It is safe to re-run the dry run and --apply.');
    } else {
      console.log(`\nRE-READ: ${ev.result.changes.length} change(s) are still wanted, but not the ones that were sent. Something else changed the data. Dry-run again and review before doing anything.`);
    }
  } catch (readErr) {
    console.log(`\nCould not read the database back either (${readErr instanceof Error ? readErr.message : String(readErr)}).`);
    console.log('When the connection is back, run the dry run: "Nothing to do" means the batch committed; the same digest as before means it did not.');
  }
  return 1;
}

// ---------------------------------------------------------------------------

function describeDriver(info: ConnectionInfo): string {
  return `${info.driver}${info.endpoint ? ` (${info.endpoint})` : ''}${info.proxy ? ` via proxy ${info.proxy}` : ''}`;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const plan = await readPlan(args.planPath, args.accounts);

  const url = process.env.DATABASE_URL;
  if (!url) throw new Exit(4, 'DATABASE_URL is not set.');
  const target = parseDatabaseUrl(url);

  const mode = args.snapshot ? 'SNAPSHOT' : args.apply ? 'APPLY' : 'DRY RUN';
  console.log(`Plan:     ${plan.planId}  (owner "${plan.owner}", tax year ${plan.taxYear})`);
  console.log(`Database: ${target.host}${target.port !== '5432' ? `:${target.port}` : ''}  database "${target.database}"`);
  const readOnlyNote = args.driver === 'http' ? 'one read-only REPEATABLE READ batch: nothing is written' : 'read-only transaction: nothing is written';
  console.log(`Mode:     ${mode}${mode === 'DRY RUN' ? `  (${readOnlyNote})` : ''}`);

  if (args.driver === 'http') {
    let http: HttpDb;
    try {
      http = connectHttp(url);
    } catch (err) {
      throw new Exit(4, err instanceof Error ? err.message : String(err));
    }
    console.log(`Driver:   ${describeDriver(http.info)}`);
    try {
      const read = httpReader(http, plan, url);
      if (args.snapshot) return await runSnapshot(read, plan);
      if (args.apply) return await runApplyHttp(http, plan, args.expectDigest!, url);
      return await runDryRun(read, plan, args);
    } finally {
      const { viaProxy, direct } = http.requestStats();
      console.log(`\nHTTP requests: ${viaProxy + direct} (${viaProxy} through the proxy${http.info.proxy ? ` ${http.info.proxy}` : ''}, ${direct} direct)`);
      await http.end().catch(() => undefined);
    }
  }

  let db: DbConnection;
  try {
    db = await connect(url, { driver: args.driver });
  } catch (err) {
    throw new Exit(1, err instanceof Error ? err.message : String(err));
  }
  console.log(`Driver:   ${describeDriver(db.info)}`);

  try {
    if (args.snapshot) return await runSnapshot(transactionReader(db, plan), plan);
    if (args.apply) return await runApply(db, plan, args.expectDigest);
    return await runDryRun(transactionReader(db, plan), plan, args);
  } finally {
    await db.end().catch(() => undefined);
  }
}

main()
  .then(code => process.exit(code))
  .catch(err => {
    if (err instanceof Exit) {
      if (err.message) console.error(err.code === 0 ? err.message : `\n${err.message}`);
      process.exit(err.code);
    }
    const url = process.env.DATABASE_URL ?? '';
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error(`\nFAILED (nothing was committed unless a "COMMITTED" line was printed above):\n${redactSecrets(message, url)}`);
    process.exit(1);
  });
