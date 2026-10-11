import { neonConfig } from '@neondatabase/serverless';
import { afterEach, describe, expect, it } from 'vitest';
import { connectHttp, neonEndpointUrl, withCause } from './http';
import type { FetchInitLike } from './proxy-fetch';

const DB_URL = 'postgresql://app_user:s3cr3t-pw@ep-example-123.eu-west-2.aws.neon.tech/app?sslmode=require';
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: { query?: string; params?: unknown[]; queries?: Array<{ query: string; params: unknown[] }> };
}

/** A fetch stand-in: records what the Neon driver sends, answers with canned JSON. */
function fakeFetch(answer: (n: number) => Response | Error) {
  const seen: Seen[] = [];
  const fetchImpl = async (input: string | URL, init: FetchInitLike = {}): Promise<Response> => {
    seen.push({ url: String(input), headers: init.headers ?? {}, body: JSON.parse(init.body ?? '{}') });
    const r = answer(seen.length);
    if (r instanceof Error) throw r;
    return r;
  };
  return { seen, fetchImpl };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const result = (rows: string[][], fields = [{ name: 'n', dataTypeID: 23 }]) => ({ command: 'SELECT', rowCount: rows.length, fields, rows });

afterEach(() => {
  neonConfig.fetchFunction = undefined;
});

/** The error a promise rejects with. */
async function failure(p: Promise<unknown>): Promise<Error & { code?: string }> {
  try {
    await p;
  } catch (e) {
    return e as Error & { code?: string };
  }
  throw new Error('expected the promise to reject');
}

describe('Neon HTTP endpoint', () => {
  it('is api.<region host>/sql, whichever endpoint host the URL names', () => {
    expect(neonEndpointUrl('ep-example-123.eu-west-2.aws.neon.tech', '5432')).toBe('https://api.eu-west-2.aws.neon.tech/sql');
    expect(neonEndpointUrl('ep-example-123-pooler.eu-west-2.aws.neon.tech', '5432')).toBe('https://api.eu-west-2.aws.neon.tech/sql');
  });
});

describe('connectHttp', () => {
  it('describes the connection without credentials, including the proxy that applies', () => {
    const { fetchImpl } = fakeFetch(() => json({}));
    const via = connectHttp(DB_URL, { env: env({ HTTPS_PROXY: 'http://user:proxypw@127.0.0.1:3128' }), fetchImpl });
    expect(via.info).toEqual({ host: 'ep-example-123.eu-west-2.aws.neon.tech', port: '443', database: 'app', driver: 'neon-http', proxy: '127.0.0.1:3128', endpoint: 'api.eu-west-2.aws.neon.tech' });
    expect(JSON.stringify(via.info)).not.toMatch(/proxypw|s3cr3t/);
    expect(connectHttp(DB_URL, { env: env({}), fetchImpl }).info.proxy).toBeNull();
    expect(connectHttp(DB_URL, { env: env({ HTTPS_PROXY: 'http://127.0.0.1:3128', NO_PROXY: '.neon.tech' }), fetchImpl }).info.proxy).toBeNull();
  });

  it('refuses a local Postgres: it has no HTTP API', () => {
    expect(() => connectHttp('postgres://u:p@127.0.0.1:5432/db', { env: env({}) })).toThrow(/--driver pg/);
    expect(() => connectHttp('postgres://u:p@localhost/db', { env: env({}) })).toThrow(/local Postgres/);
  });

  it('query(): one POST with the connection string, raw-text and array-mode headers, rows parsed by type', async () => {
    const { seen, fetchImpl } = fakeFetch(() => json(result([['5']])));
    const db = connectHttp(DB_URL, { env: env({}), fetchImpl });
    expect(await db.query('SELECT $1::integer AS n', [5])).toEqual([{ n: 5 }]);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe('https://api.eu-west-2.aws.neon.tech/sql');
    expect(seen[0].headers['Neon-Connection-String']).toBe(DB_URL);
    expect(seen[0].headers['Neon-Raw-Text-Output']).toBe('true');
    expect(seen[0].headers['Neon-Array-Mode']).toBe('true');
    expect(seen[0].headers['Neon-Batch-Isolation-Level']).toBeUndefined();
    expect(seen[0].body).toEqual({ query: 'SELECT $1::integer AS n', params: ['5'] });
  });

  it('readBatch(): ONE request, READ ONLY, REPEATABLE READ, statements in order', async () => {
    const { seen, fetchImpl } = fakeFetch(() => json({ results: [result([['1']]), result([['2']])] }));
    const db = connectHttp(DB_URL, { env: env({}), fetchImpl });
    const rows = await db.readBatch([
      { text: 'SELECT 1 AS n', params: [] },
      { text: 'SELECT $1::integer AS n', params: [2] },
    ]);
    expect(rows).toEqual([[{ n: 1 }], [{ n: 2 }]]);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['Neon-Batch-Isolation-Level']).toBe('RepeatableRead');
    expect(seen[0].headers['Neon-Batch-Read-Only']).toBe('true');
    expect(seen[0].body.queries).toEqual([
      { query: 'SELECT 1 AS n', params: [] },
      { query: 'SELECT $1::integer AS n', params: ['2'] },
    ]);
  });

  it('writeBatch(): ONE request, READ WRITE, READ COMMITTED (so each statement sees what the lock holder committed)', async () => {
    const { seen, fetchImpl } = fakeFetch(() => json({ results: [result([['1']]), result([['13']], [{ name: 'touched', dataTypeID: 23 }])] }));
    const db = connectHttp(DB_URL, { env: env({}), fetchImpl });
    const rows = await db.writeBatch([
      { text: 'SELECT 1 AS n', params: [] },
      { text: 'SELECT 13 AS touched', params: [] },
    ]);
    expect(rows[1]).toEqual([{ touched: 13 }]);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers['Neon-Batch-Isolation-Level']).toBe('ReadCommitted');
    expect(seen[0].headers['Neon-Batch-Read-Only']).toBe('false');
    expect(seen[0].body.queries).toHaveLength(2);
  });

  it('passes a Postgres error through with its SQLSTATE, so the caller can tell "rolled back" from "unknown"', async () => {
    const { fetchImpl } = fakeFetch(() => json({ message: 'invalid input syntax for type integer: "data-plan race check failed: x"', code: '22P02', severity: 'ERROR' }, 400));
    const db = connectHttp(DB_URL, { env: env({}), fetchImpl });
    await expect(db.writeBatch([{ text: 'SELECT 1', params: [] }])).rejects.toMatchObject({ name: 'NeonDbError', code: '22P02', message: expect.stringContaining('race check failed') });
  });

  it('wraps a transport failure with hints and no credentials, and says the write may have been received', async () => {
    const { fetchImpl } = fakeFetch(() => new Error(`socket hang up (${DB_URL})`));
    const db = connectHttp(DB_URL, { env: env({ HTTPS_PROXY: 'http://127.0.0.1:3128' }), fetchImpl });
    const err = await failure(db.writeBatch([{ text: 'SELECT 1', params: [] }]));
    expect(err.message).toContain('The write request to api.eu-west-2.aws.neon.tech:443 (neon-http via proxy 127.0.0.1:3128)');
    expect(err.message).toContain('may or may not have been received');
    expect(err.message).not.toContain('s3cr3t-pw');
    expect(err.code).toBeUndefined();
    const read = await failure(db.query('SELECT 1'));
    expect(read.message).toContain('Could not connect to api.eu-west-2.aws.neon.tech:443');
  });

  it('treats a non-JSON 5xx as a transport failure (no SQLSTATE)', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('<html>bad gateway</html>', { status: 502 }));
    const db = connectHttp(DB_URL, { env: env({}), fetchImpl });
    const err = await failure(db.writeBatch([{ text: 'SELECT 1', params: [] }]));
    expect(err.message).toContain('Server error (HTTP status 502)');
    expect(err.code).toBeUndefined();
  });
});

describe('withCause', () => {
  it('puts the real reason behind "fetch failed" into the text', () => {
    const source = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('getaddrinfo ENOTFOUND api.example'), { code: 'ENOTFOUND' }) });
    const err = Object.assign(new Error('Error connecting to database: TypeError: fetch failed'), { sourceError: source });
    expect((withCause(err) as Error).message).toBe('Error connecting to database: TypeError: fetch failed (ENOTFOUND: getaddrinfo ENOTFOUND api.example)');
  });

  it('leaves everything else alone', () => {
    const plain = new Error('x');
    expect(withCause(plain)).toBe(plain);
    expect(withCause('text')).toBe('text');
    expect(withCause(null)).toBeNull();
  });
});
