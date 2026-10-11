import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockStatement, LOCK_HELD_TEXT, noteSql, ParamList, raceCheckStatement, RACE_CHECK_MARKER, setupStatement, type BatchStatement } from './http-statements';

/**
 * The one thing a unit test over SQL text cannot show: that the lock, the
 * counters and the race check really do what they claim inside Postgres, in a
 * single non-interactive batch. Skipped unless DATA_PLAN_TEST_PG_URL points at
 * a throwaway Postgres; it creates only a TEMP table, so it leaves nothing behind.
 *
 *   DATA_PLAN_TEST_PG_URL=postgres://postgres@127.0.0.1:5432/postgres npx vitest run src/lib/data-plan/http-statements.pg.test.ts
 */
const url = process.env.DATA_PLAN_TEST_PG_URL;
const TEST_LOCK_KEY = 727499; // not the loader's own key

/** A guarded write over the temp table, shaped exactly like the loader's own (data-modifying CTE + noteSql tail). */
function insertOnce(value: string, expected = 1): BatchStatement {
  const p = new ParamList();
  const v = p.add(value);
  const label = `insert ${value}`;
  const text = `WITH w AS (
  INSERT INTO pg_temp.fx_race (v) SELECT ${v}::text WHERE NOT EXISTS (SELECT 1 FROM pg_temp.fx_race WHERE v = ${v}::text) RETURNING id
)
${noteSql(p, '(SELECT count(*) FROM w)::integer', expected, label)}`;
  return { kind: 'write', label, text, params: p.values, expected };
}

describe.skipIf(!url)('lock, counters and race check inside Postgres', () => {
  let c: Client;
  let other: Client;

  beforeAll(async () => {
    c = new Client({ connectionString: url });
    other = new Client({ connectionString: url });
    await Promise.all([c.connect(), other.connect()]);
    await c.query('CREATE TEMP TABLE fx_race (id serial PRIMARY KEY, v text NOT NULL)');
  });
  afterAll(async () => {
    await Promise.all([c?.end(), other?.end()]);
  });

  /** Run statements as one transaction, the way the HTTP API does; resolves with the rows of each, or the error. */
  async function batch(statements: BatchStatement[], commit: boolean) {
    await c.query('BEGIN ISOLATION LEVEL READ COMMITTED READ WRITE');
    try {
      const results = [];
      for (const s of statements) results.push((await c.query(s.text, s.params)).rows);
      await c.query(commit ? 'COMMIT' : 'ROLLBACK');
      return { results, error: null as null };
    } catch (error) {
      await c.query('ROLLBACK');
      return { results: [], error: error as Error & { code?: string } };
    }
  }
  const rows = async () => (await c.query('SELECT v FROM pg_temp.fx_race ORDER BY id')).rows.map(r => r.v);
  const clear = () => c.query('DELETE FROM pg_temp.fx_race');

  it('passes, and reports the total, when every guard fires as expected', async () => {
    await clear();
    const r = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), insertOnce('a'), insertOnce('b'), raceCheckStatement(2)], true);
    expect(r.error).toBeNull();
    expect(r.results[r.results.length - 1]).toEqual([{ touched: 2 }]);
    expect(await rows()).toEqual(['a', 'b']);
  });

  it('raises, rolling back EVERY earlier write, when a guard did not fire', async () => {
    await clear();
    // the second insert is skipped by its NOT EXISTS guard (a lost race), so it touches 0 rows instead of 1
    const r = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), insertOnce('a'), insertOnce('a'), insertOnce('b'), raceCheckStatement(3)], true);
    expect(r.error?.code).toBe('22P02');
    expect(r.error?.message).toContain(RACE_CHECK_MARKER);
    expect(r.error?.message).toContain('expected 3 guarded row(s) to be touched but 2 were');
    expect(r.error?.message).toContain('insert a (touched 0, expected 1)');
    expect(await rows()).toEqual([]);
  });

  it('raises when a statement touches MORE than expected too', async () => {
    await clear();
    const r = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), insertOnce('a', 0), raceCheckStatement(0)], true);
    expect(r.error?.message).toContain(RACE_CHECK_MARKER);
    expect(r.error?.message).toContain('insert a (touched 1, expected 0)');
    expect(await rows()).toEqual([]);
  });

  it('the counters start from zero in every transaction and do not leak between them', async () => {
    await clear();
    const first = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), insertOnce('a'), raceCheckStatement(1)], true);
    expect(first.error).toBeNull();
    const second = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), insertOnce('b'), raceCheckStatement(1)], true);
    expect(second.error).toBeNull();
    expect(second.results[second.results.length - 1]).toEqual([{ touched: 1 }]);
    const stray = await c.query("SELECT current_setting('dataplan.touched', true) AS t");
    expect([null, '']).toContain(stray.rows[0].t);
  });

  it('the lock statement raises at once when another session holds the loader lock, and passes when it is free', async () => {
    await other.query('SELECT pg_advisory_lock($1::bigint)', [TEST_LOCK_KEY]);
    try {
      const held = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), raceCheckStatement(0)], true);
      expect(held.error?.code).toBe('22P02');
      expect(held.error?.message).toContain(LOCK_HELD_TEXT);
    } finally {
      await other.query('SELECT pg_advisory_unlock($1::bigint)', [TEST_LOCK_KEY]);
    }
    const free = await batch([lockStatement(TEST_LOCK_KEY), setupStatement(), raceCheckStatement(0)], true);
    expect(free.error).toBeNull();
  });
});
