import { PROFILE_FIELD_COLUMNS, type TaxProfileField } from './schema';
import { orderForApply, TENANCY_COLUMNS } from './statements';
import type { Change, TenancyUpdatable } from './types';

/**
 * Write side of the HTTP driver. Neon's HTTP API cannot hold an interactive
 * transaction (BEGIN ... read ... write ... COMMIT), so apply sends ALL its
 * writes as ONE non-interactive batch, which Postgres runs as a single
 * transaction: every statement commits together or none does.
 *
 * Nothing can be read inside that transaction before writing, so every write
 * guards itself at the SQL level, and the batch ends with a check that makes
 * Postgres roll the whole thing back if any guard did not fire as expected:
 *
 *   0. lock      pg_try_advisory_xact_lock with the loader's key; a held lock raises
 *   1. setup     transaction-local timeouts and the two counters (see below)
 *   2. writes    one statement per change, each of the form
 *                  WITH w AS (<guarded INSERT/UPDATE ... RETURNING ...>)
 *                  SELECT <add the rows w touched to the counter>
 *                Guards: INSERTs only WHERE NOT EXISTS (same reference / same
 *                tenancy start); UPDATEs only WHERE the columns still hold the
 *                values the plan was based on; tagging only WHERE
 *                property_id IS NULL. A guard that does not match changes
 *                zero rows; it does not error, so the batch carries on and the
 *                final check below catches it.
 *   3. check     raises unless the rows touched equal the rows expected
 *
 * The counters are two transaction-local settings (set_config(.., .., true)),
 * which are discarded at COMMIT/ROLLBACK and so cannot leak to another
 * session on a pooled connection:
 *   dataplan.touched     running total of rows the guarded statements touched
 *   dataplan.shortfalls  one entry per statement that touched an unexpected number
 *
 * A journal and its book entries are ONE statement (a CTE chain: the book
 * entries are inserted FROM the journal row the same statement just inserted),
 * so a journal skipped by its guard also skips its legs, and a leg can never
 * be written without its journal.
 *
 * Raising an error needs no PL/pgSQL: casting text to integer fails with
 * `invalid input syntax for type integer: "<the text>"`, which puts our
 * message in the error Postgres (and the HTTP API) returns. The cast is fed
 * by current_setting(), which is STABLE, so the planner cannot fold the
 * failing branch at plan time (a constant `CASE ... ELSE 1/0` can fail even
 * when the branch is never taken).
 *
 * Like statements.ts, this module only ever INSERTs and UPDATEs.
 */

/** Same key as the interactive path: one loader run at a time. */
export const LOADER_LOCK_KEY = 727401;

/** Every error this module raises on purpose contains this text. */
export const RACE_CHECK_MARKER = 'data-plan race check failed';

/** Part of the message raised when the loader lock is already held. */
export const LOCK_HELD_TEXT = 'another data-plan run holds the loader lock';

export const TOUCHED_SETTING = 'dataplan.touched';
export const SHORTFALL_SETTING = 'dataplan.shortfalls';

export interface BatchStatement {
  kind: 'lock' | 'setup' | 'write' | 'check';
  /** Short human label, also used in race-check diagnostics. */
  label: string;
  text: string;
  params: unknown[];
  /** Rows the statement must touch (writes only; 0 otherwise). */
  expected: number;
  /** The change a write statement carries out. */
  change?: Change;
}

export interface WriteBatch {
  statements: BatchStatement[];
  /** Sum of the writes' expected counts: what the final check compares with. */
  expectedTouched: number;
  /** Number of write statements (one per change). */
  writeCount: number;
  /** Rough size of the request body, to refuse absurdly large batches before sending. */
  approxBytes: number;
}

/** Numbered parameter collector: add() returns the "$n" to put in the SQL text. */
export class ParamList {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

const readTouched = () => `COALESCE(NULLIF(current_setting('${TOUCHED_SETTING}', true), ''), '0')::integer`;
const readShortfalls = () => `COALESCE(current_setting('${SHORTFALL_SETTING}', true), '')`;

/** SQL expression that raises an error carrying `messageExpr` (text) as its message. */
export function raiseSql(messageExpr: string): string {
  return `(${messageExpr})::integer`;
}

/**
 * The tail every write statement ends with: add the rows the CTE touched to
 * the running total and, when that is not the expected number, record the
 * statement in the shortfall list. `countExpr` is an integer expression over
 * the statement's CTEs.
 */
export function noteSql(p: ParamList, countExpr: string, expected: number, label: string): string {
  const exp = p.add(expected);
  const lab = p.add(label);
  return `SELECT set_config('${TOUCHED_SETTING}', (${readTouched()} + t.n)::text, true) AS touched,
       set_config('${SHORTFALL_SETTING}', ${readShortfalls()}
         || CASE WHEN t.n = ${exp}::integer THEN '' ELSE ' ' || ${lab}::text || ' (touched ' || t.n || ', expected ' || ${exp}::integer || ');' END, true) AS shortfalls
  FROM (SELECT ${countExpr} AS n) AS t`;
}

const count = (cte: string) => `(SELECT count(*) FROM ${cte})::integer`;

export function lockStatement(lockKey: number = LOADER_LOCK_KEY): BatchStatement {
  const p = new ParamList();
  const key = p.add(lockKey);
  return {
    kind: 'lock',
    label: 'loader advisory lock',
    text: `SELECT CASE WHEN pg_try_advisory_xact_lock(${key}::bigint) THEN 1
            ELSE ${raiseSql(`concat('${RACE_CHECK_MARKER}: ${LOCK_HELD_TEXT} (key ', ${key}::bigint, '). Nothing was committed.')`)} END AS locked`,
    params: p.values,
    expected: 0,
  };
}

export function setupStatement(): BatchStatement {
  return {
    kind: 'setup',
    label: 'transaction-local timeouts and counters',
    text: `SELECT set_config('statement_timeout', '120000', true) AS statement_timeout,
       set_config('lock_timeout', '15000', true) AS lock_timeout,
       set_config('${TOUCHED_SETTING}', '0', true) AS touched,
       set_config('${SHORTFALL_SETTING}', '', true) AS shortfalls`,
    params: [],
    expected: 0,
  };
}

/** The final statement: raises (rolling the whole batch back) unless every guard fired as expected. */
export function raceCheckStatement(expectedTouched: number): BatchStatement {
  const p = new ParamList();
  const exp = p.add(expectedTouched);
  const message =
    `concat('${RACE_CHECK_MARKER}: expected ', ${exp}::integer, ' guarded row(s) to be touched but ', ${readTouched()}, ' were.', ` +
    `${readShortfalls()}, ' The data changed between the read and the write. Nothing was committed.')`;
  return {
    kind: 'check',
    label: 'race check',
    text: `SELECT CASE WHEN ${readTouched()} = ${exp}::integer AND ${readShortfalls()} = '' THEN ${readTouched()}
            ELSE ${raiseSql(message)} END AS touched`,
    params: p.values,
    expected: 0,
  };
}

// ---------------------------------------------------------------------------
// guarded writes, one builder per change type
// ---------------------------------------------------------------------------

function lettingTypeWrite(c: Extract<Change, { type: 'letting_type' }>): BatchStatement {
  const p = new ParamList();
  const to = p.add(c.to);
  const id = p.add(c.propertyId);
  const from = p.add(c.from);
  const label = `letting type of ${c.propertyName}`;
  const text = `WITH w AS (
  UPDATE properties SET letting_type = ${to}::text
   WHERE id = ${id}::integer AND letting_type = ${from}::text
  RETURNING id
)
${noteSql(p, count('w'), 1, label)}`;
  return { kind: 'write', label, text, params: p.values, expected: 1, change: c };
}

function tenancyCreateWrite(c: Extract<Change, { type: 'tenancy_create' }>): BatchStatement {
  const p = new ParamList();
  const v = c.values;
  const property = p.add(c.propertyId);
  const tenant = p.add(v.tenantName);
  const start = p.add(v.startDate);
  const end = p.add(v.endDate);
  const rent = p.add(v.rentAmount);
  const freq = p.add(v.rentFrequency);
  const deposit = p.add(v.depositAmount);
  const notes = p.add(v.notes);
  const label = `tenancy starting ${v.startDate} at ${c.propertyName}`;
  const text = `WITH w AS (
  INSERT INTO tenancies (property_id, tenant_name, start_date, end_date, rent_amount, rent_frequency, deposit_amount, notes)
  SELECT ${property}::integer, ${tenant}::text, ${start}::text, ${end}::text, ${rent}::numeric, ${freq}::rent_frequency, ${deposit}::numeric, ${notes}::text
   WHERE NOT EXISTS (SELECT 1 FROM tenancies WHERE property_id = ${property}::integer AND start_date = ${start}::text)
  RETURNING id
)
${noteSql(p, count('w'), 1, label)}`;
  return { kind: 'write', label, text, params: p.values, expected: 1, change: c };
}

function tenancyUpdateWrite(c: Extract<Change, { type: 'tenancy_update' }>): BatchStatement | null {
  const fields = Object.keys(c.set) as TenancyUpdatable[];
  if (fields.length === 0) return null;
  const p = new ParamList();
  const assignments = fields.map(f => {
    const col = TENANCY_COLUMNS[f];
    return `${col.column} = ${p.add(c.set[f] ?? null)}::${col.cast}`;
  });
  const id = p.add(c.tenancyId);
  const property = p.add(c.propertyId);
  const start = p.add(c.startDate);
  // Optimistic check: every column we overwrite must still hold the text the plan was based on.
  const unchanged = fields.map(f => `tenancies.${TENANCY_COLUMNS[f].column}::text IS NOT DISTINCT FROM ${p.add(c.before[f] ?? null)}::text`);
  const label = `tenancy #${c.tenancyId} at ${c.propertyName}`;
  const text = `WITH w AS (
  UPDATE tenancies SET ${assignments.join(', ')}
   WHERE id = ${id}::integer AND property_id = ${property}::integer AND start_date = ${start}::text
     AND ${unchanged.join('\n     AND ')}
  RETURNING id
)
${noteSql(p, count('w'), 1, label)}`;
  return { kind: 'write', label, text, params: p.values, expected: 1, change: c };
}

function journalCreateWrite(c: Extract<Change, { type: 'journal_create' }>): BatchStatement {
  const p = new ParamList();
  const date = p.add(c.date);
  const description = p.add(c.description);
  const reference = p.add(c.reference);
  const category = p.add(c.categoryId);
  const property = p.add(c.propertyId);
  const legs = c.legs.map(l => `(${p.add(l.accountId)}::integer, ${p.add(l.amount)}::numeric)`);
  const label = `journal ${c.reference}`;
  const expected = 1 + c.legs.length;
  const text = `WITH j AS (
  INSERT INTO journal_entries (date, description, reference, category_id, property_id)
  SELECT ${date}::text, ${description}::text, ${reference}::text, ${category}::integer, ${property}::integer
   WHERE NOT EXISTS (SELECT 1 FROM journal_entries WHERE reference = ${reference}::text)
  RETURNING id
), b AS (
  INSERT INTO book_entries (journal_entry_id, account_id, amount)
  SELECT j.id, v.account_id, v.amount
    FROM j CROSS JOIN (VALUES ${legs.join(', ')}) AS v(account_id, amount)
  RETURNING id
)
${noteSql(p, `${count('j')} + ${count('b')}`, expected, label)}`;
  return { kind: 'write', label, text, params: p.values, expected, change: c };
}

function journalTagWrite(c: Extract<Change, { type: 'journal_tag' }>): BatchStatement {
  const p = new ParamList();
  const property = p.add(c.propertyId);
  const category = p.add(c.setCategoryId);
  const id = p.add(c.journalId);
  const date = p.add(c.date);
  const amount = p.add(c.amount);
  const label = `tag journal #${c.journalId}`;
  // Still untagged, still on the date and amount the plan matched, still not a transfer.
  const text = `WITH w AS (
  UPDATE journal_entries
     SET property_id = ${property}::integer,
         category_id = COALESCE(category_id, ${category}::integer)
   WHERE id = ${id}::integer AND property_id IS NULL
     AND journal_entries.date = ${date}::text
     AND COALESCE(is_transfer, FALSE) = FALSE
     AND EXISTS (SELECT 1 FROM book_entries be JOIN accounts a ON a.id = be.account_id
                  WHERE be.journal_entry_id = journal_entries.id
                    AND a.account_type IN ('INCOME', 'EXPENSE')
                    AND ABS(be.amount::numeric) = ${amount}::numeric)
  RETURNING id
)
${noteSql(p, count('w'), 1, label)}`;
  return { kind: 'write', label, text, params: p.values, expected: 1, change: c };
}

function taxProfileWrite(c: Extract<Change, { type: 'tax_profile' }>): BatchStatement {
  const p = new ParamList();
  const fields = Object.keys(c.set) as TaxProfileField[];
  const columns: string[] = ['owner_id', 'tax_year'];
  const values: string[] = [`${p.add(c.ownerId)}::integer`, `${p.add(c.taxYear)}::text`];
  const updates: string[] = [];
  const unchanged: string[] = [];
  for (const f of fields) {
    const column = PROFILE_FIELD_COLUMNS[f];
    columns.push(column);
    values.push(`${p.add(c.set[f])}::numeric`);
    updates.push(`${column} = EXCLUDED.${column}`);
  }
  if (c.notes !== null) {
    columns.push('notes');
    values.push(`${p.add(c.notes)}::text`);
    updates.push('notes = EXCLUDED.notes');
  }
  // The optimistic guard exists only for an UPDATE of a row the plan saw; its
  // parameters are added only then (an unreferenced parameter is an error in Postgres).
  if (c.existed) {
    for (const f of fields) {
      const prev = c.previous?.[f];
      if (prev !== undefined) unchanged.push(`owner_tax_profiles.${PROFILE_FIELD_COLUMNS[f]}::text IS NOT DISTINCT FROM ${p.add(prev)}::text`);
    }
    if (c.notes !== null) unchanged.push(`owner_tax_profiles.notes IS NOT DISTINCT FROM ${p.add(c.previousNotes)}::text`);
  }
  updates.push('updated_at = now()');
  const label = `owner tax profile ${c.ownerName} ${c.taxYear}`;
  // No row at read time: a row appearing since is a lost race, not something to overwrite.
  // A row at read time: update it only if the columns we overwrite still hold what the plan saw.
  const conflict = c.existed
    ? `ON CONFLICT (owner_id, tax_year) DO UPDATE SET ${updates.join(', ')}${unchanged.length > 0 ? `\n   WHERE ${unchanged.join('\n     AND ')}` : ''}`
    : 'ON CONFLICT (owner_id, tax_year) DO NOTHING';
  const text = `WITH w AS (
  INSERT INTO owner_tax_profiles (${columns.join(', ')})
  VALUES (${values.join(', ')})
  ${conflict}
  RETURNING id
)
${noteSql(p, count('w'), 1, label)}`;
  return { kind: 'write', label, text, params: p.values, expected: 1, change: c };
}

/** The guarded write statement for one change, or null when there is nothing to write. */
export function guardedWrite(change: Change): BatchStatement | null {
  switch (change.type) {
    case 'letting_type':
      return lettingTypeWrite(change);
    case 'tenancy_create':
      return tenancyCreateWrite(change);
    case 'tenancy_update':
      return tenancyUpdateWrite(change);
    case 'journal_create':
      return journalCreateWrite(change);
    case 'journal_tag':
      return journalTagWrite(change);
    case 'tax_profile':
      return taxProfileWrite(change);
  }
}

/** Largest request body the loader will send (Neon's HTTP API caps request size; stay well under). */
export const MAX_BATCH_BYTES = 8_000_000;

/**
 * Assemble the whole batch for a change set: lock, setup, one guarded write
 * per change in the loader's stable apply order, then the race check.
 */
export function buildWriteBatch(changes: readonly Change[], options: { lockKey?: number } = {}): WriteBatch {
  const writes = orderForApply(changes)
    .map(guardedWrite)
    .filter((s): s is BatchStatement => s !== null);
  const expectedTouched = writes.reduce((sum, s) => sum + s.expected, 0);
  const statements = [lockStatement(options.lockKey), setupStatement(), ...writes, raceCheckStatement(expectedTouched)];
  const approxBytes = statements.reduce((sum, s) => sum + s.text.length + JSON.stringify(s.params).length + 32, 0);
  return { statements, expectedTouched, writeCount: writes.length, approxBytes };
}

// ---------------------------------------------------------------------------
// what went wrong, from the error the HTTP API returned
// ---------------------------------------------------------------------------

export type WriteFailure =
  /** Postgres ran the batch and rolled it back: nothing was committed. */
  | { kind: 'rolled_back'; code: string; message: string; raceLost: boolean; lockHeld: boolean }
  /** The request failed without a database verdict (network, proxy, 5xx): the batch MAY have committed. */
  | { kind: 'unknown'; message: string };

/**
 * A NeonDbError carrying a 5-character SQLSTATE `code` is an answer from
 * Postgres (the transaction was rolled back). Anything else (a socket error,
 * a proxy error page, an HTTP 5xx) is not: the request might even have been
 * committed before the response was lost.
 */
export function classifyWriteFailure(err: unknown): WriteFailure {
  const e = err as { message?: unknown; code?: unknown } | null;
  const message = e && typeof e.message === 'string' ? e.message : String(err);
  const code = e && typeof e.code === 'string' ? e.code : '';
  if (/^[0-9A-Z]{5}$/.test(code)) {
    const raceLost = message.includes(RACE_CHECK_MARKER);
    return { kind: 'rolled_back', code, message, raceLost, lockHeld: raceLost && message.includes(LOCK_HELD_TEXT) };
  }
  return { kind: 'unknown', message };
}

/** The part of a race-check error message after the marker, for display. */
export function raceDetail(message: string): string {
  const at = message.indexOf(RACE_CHECK_MARKER);
  if (at === -1) return message;
  return message.slice(at).replace(/"\s*$/, '');
}
