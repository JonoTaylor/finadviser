/**
 * Safe, idempotent data loader.
 *
 * Reads a JSON "data plan" (see src/lib/data-plan/schema.ts and
 * scripts/data-plan.example.json), compares it with the database and either
 * prints what it would change (default), prints the current state
 * (--snapshot) or makes the changes in ONE transaction (--apply).
 *
 *   DATABASE_URL=postgres://... npm run data-plan:check -- --plan plan.json --snapshot
 *   DATABASE_URL=postgres://... npm run data-plan:check -- --plan plan.json            # dry run
 *   DATABASE_URL=postgres://... npm run data-plan:apply -- --plan plan.json            # writes
 *
 * Options
 *   --plan <file>           plan JSON (required)
 *   --snapshot              print the current database state relevant to the plan, then stop
 *   --apply                 make the changes (default is a read-only dry run)
 *   --account alias=Name    set/override a plan account alias (repeatable)
 *   --expect-digest <hex>   with --apply: refuse unless the change set matches the dry run's digest
 *   --driver auto|pg|neon   auto = pg for localhost/127.0.0.1, Neon WebSocket client otherwise
 *
 * Run it from the web/ directory (tsx resolves the '@/' import alias from the
 * tsconfig.json in the working directory); the npm scripts already do.
 *
 * Safety properties
 *   - dry run and snapshot run inside a READ ONLY transaction: they cannot write
 *   - the loader only INSERTs and UPDATEs; it never deletes anything
 *   - --apply is one transaction (BEGIN/COMMIT, ROLLBACK on any error) under
 *     an advisory lock, re-checks its own result before COMMIT, and a second
 *     --apply changes nothing
 *   - every journal it creates carries reference 'plan:<planId>:<itemId>'
 *
 * Exit codes: 0 ok, 1 unexpected error, 2 refused (preconditions), 3 blocked
 * items (dry run: not ready to apply), 4 bad usage or invalid plan.
 */

import { readFile } from 'node:fs/promises';
import { connect, parseDatabaseUrl, redactSecrets, type DbConnection, type DriverChoice } from '../src/lib/data-plan/connect';
import { changeDigest, renderChange, renderPlanResult, renderSnapshot, renderTotals, renderTotalsComparison } from '../src/lib/data-plan/format';
import { planChanges } from '../src/lib/data-plan/planner';
import { parsePlan, PlanValidationError, type Plan } from '../src/lib/data-plan/schema';
import { simulateChanges } from '../src/lib/data-plan/simulate';
import { loadState, checkSchema } from '../src/lib/data-plan/state';
import { applyChange, orderForApply } from '../src/lib/data-plan/statements';
import { computeOwnerTotals, resolveAllocationPct, totalsEqual } from '../src/lib/data-plan/totals';
import type { DbState, OwnerTotals, PlanResult } from '../src/lib/data-plan/types';

const LOCK_KEY = 727401; // arbitrary constant: one loader run at a time

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
    '  --driver auto|pg|neon  database driver (default auto)',
    '',
    'DATABASE_URL must be set in the environment.',
  ].join('\n');
}

function parseArgs(argv: string[]): Args {
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
      case '--driver': {
        const v = takeValue(i++, a);
        if (v !== 'auto' && v !== 'pg' && v !== 'neon') throw new Exit(4, `--driver must be auto, pg or neon (got "${v}")`);
        args.driver = v;
        break;
      }
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
  if (!args.planPath) throw new Exit(4, `--plan is required\n\n${usage()}`);
  if (args.snapshot && args.apply) throw new Exit(4, '--snapshot and --apply cannot be combined');
  if (args.expectDigest && !args.apply) throw new Exit(4, '--expect-digest only makes sense with --apply');
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

async function inReadOnlyTransaction<T>(db: DbConnection, fn: () => Promise<T>): Promise<T> {
  // REPEATABLE READ: every query in the snapshot sees one consistent moment, even if a bank sync lands meanwhile.
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    return await fn();
  } finally {
    await db.query('ROLLBACK').catch(() => undefined);
  }
}

interface Evaluation {
  state: DbState;
  result: PlanResult;
  before: OwnerTotals | null;
  after: OwnerTotals | null;
}

async function schemaProblems(db: DbConnection): Promise<string[]> {
  return checkSchema(db);
}

function schemaRefusal(problems: string[]): string {
  const needsMigrate = problems.some(p => p.includes('letting_type') || p.includes('owner_tax_profiles'));
  return [
    'The database schema is not ready for this loader:',
    ...problems.map(p => `  - ${p}`),
    '',
    needsMigrate
      ? 'Run "npm run db:migrate" (it applies src/lib/db/migration.sql) against this database first, then re-run.'
      : 'Run "npm run db:migrate" against this database first; if that does not fix it the database is not an app database.',
  ].join('\n');
}

async function evaluate(db: DbConnection, plan: Plan): Promise<Evaluation> {
  const state = await loadState(db, plan);
  const result = planChanges(plan, state);
  if (result.refusals.length > 0) return { state, result, before: null, after: null };
  const owner = state.owners.find(o => o.name === plan.owner)!;
  const before = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state });
  const after = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state: simulateChanges(state, result.changes) });
  return { state, result, before, after };
}

function printRefusals(refusals: string[]): void {
  console.log('\n== REFUSED: nothing was changed ==');
  for (const r of refusals) console.log(`  - ${r}`);
}

function printPreconditions(plan: Plan, state: DbState): void {
  const owner = state.owners.find(o => o.name === plan.owner);
  if (!owner) return;
  console.log('\n== Preconditions (all passed) ==');
  console.log('  schema: properties.letting_type and owner_tax_profiles are present');
  console.log(`  owner "${owner.name}" exists (#${owner.id})`);
  for (const section of plan.properties) {
    const p = state.properties.find(x => x.name === section.name)!;
    const share = resolveAllocationPct(p.id, owner.id, state.allocationRules, state.ownership).toFixed(4);
    console.log(`  property "${p.name}" exists (#${p.id}, letting_type=${p.lettingType}); owner's share ${share}%`);
  }
}

function printEvaluation(plan: Plan, ev: Evaluation, heading: string): void {
  printPreconditions(plan, ev.state);
  console.log(`\n${renderPlanResult(ev.result, heading)}`);
  if (ev.before && ev.after) console.log(`\n${renderTotalsComparison(ev.before, ev.after, 'After (predicted)')}`);
}

async function runSnapshot(db: DbConnection, plan: Plan): Promise<number> {
  return inReadOnlyTransaction(db, async () => {
    const problems = await schemaProblems(db);
    if (problems.length > 0) {
      console.log(`\n${schemaRefusal(problems)}`);
      return 2;
    }
    const state = await loadState(db, plan);
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
  });
}

async function runDryRun(db: DbConnection, plan: Plan, planPath: string): Promise<number> {
  const outcome = await inReadOnlyTransaction(db, async () => {
    const problems = await schemaProblems(db);
    if (problems.length > 0) {
      console.log(`\n${schemaRefusal(problems)}`);
      return { code: 2 as const };
    }
    return { code: 0 as const, ev: await evaluate(db, plan) };
  });
  if (outcome.code !== 0 || !outcome.ev) return outcome.code;
  const ev = outcome.ev;

  if (ev.result.refusals.length > 0) {
    printRefusals(ev.result.refusals);
    return 2;
  }
  printEvaluation(plan, ev, 'Changes it WOULD make');
  const digest = changeDigest(ev.result.changes);
  console.log(`\nChange digest: ${digest}  (${ev.result.changes.length} change${ev.result.changes.length === 1 ? '' : 's'})`);
  if (ev.result.blocked.length > 0) {
    console.log(`\nNOT READY: ${ev.result.blocked.length} included item(s) are blocked. --apply would refuse. Fix the plan or pass --account, then dry-run again.`);
    return 3;
  }
  console.log(
    ev.result.changes.length === 0
      ? '\nNothing to do: the database already matches the plan.'
      : `\nTo apply exactly these changes: npm run data-plan:apply -- --plan ${planPath} --expect-digest ${digest}`,
  );
  return 0;
}

async function runApply(db: DbConnection, plan: Plan, expectDigest: string | null): Promise<number> {
  console.log('\nAPPLY: one transaction, rolled back on any error.');
  await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  let open = true;
  let before: OwnerTotals | null = null;
  let changeCount = 0;
  try {
    await db.query('SET LOCAL statement_timeout = 120000');
    await db.query('SET LOCAL lock_timeout = 15000');
    const lock = await db.query<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock($1::bigint) AS locked', [LOCK_KEY]);
    if (!lock.rows[0]?.locked) throw new Exit(2, 'Another data-plan run holds the loader lock. Wait for it to finish and re-run.');

    const problems = await schemaProblems(db);
    if (problems.length > 0) throw new Exit(2, schemaRefusal(problems));

    const ev = await evaluate(db, plan);
    if (ev.result.refusals.length > 0) {
      printRefusals(ev.result.refusals);
      throw new Exit(2);
    }
    printEvaluation(plan, ev, 'Changes to make');
    const digest = changeDigest(ev.result.changes);
    console.log(`\nChange digest: ${digest}  (${ev.result.changes.length} change${ev.result.changes.length === 1 ? '' : 's'})`);

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
    const recheck = await evaluate(db, plan);
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
  console.log(`\nCOMMITTED ${changeCount} change${changeCount === 1 ? '' : 's'}. Re-reading from the database...`);
  await inReadOnlyTransaction(db, async () => {
    const state = await loadState(db, plan);
    console.log(`\n== After-state (re-read) ==\n${renderSnapshot(plan, state)}`);
    const owner = state.owners.find(o => o.name === plan.owner)!;
    const after = computeOwnerTotals({ ownerId: owner.id, taxYear: plan.taxYear, state });
    if (before) console.log(`\n${renderTotalsComparison(before, after, 'After (re-read)')}`);
    const rerun = planChanges(plan, state);
    console.log(
      rerun.changes.length === 0
        ? '\nIdempotency check: re-planning against the committed state finds 0 changes.'
        : `\nWARNING: re-planning against the committed state still finds ${rerun.changes.length} change(s).`,
    );
  });
  return 0;
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
  console.log(`Mode:     ${mode}${mode === 'DRY RUN' ? '  (read-only transaction: nothing is written)' : ''}`);

  let db: DbConnection;
  try {
    db = await connect(url, { driver: args.driver });
  } catch (err) {
    throw new Exit(1, err instanceof Error ? err.message : String(err));
  }
  console.log(`Driver:   ${db.info.driver}${db.info.proxy ? ` via proxy ${db.info.proxy}` : ''}`);

  try {
    if (args.snapshot) return await runSnapshot(db, plan);
    if (args.apply) return await runApply(db, plan, args.expectDigest);
    return await runDryRun(db, plan, args.planPath);
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
