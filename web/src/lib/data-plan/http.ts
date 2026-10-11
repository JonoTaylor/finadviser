import { neon, neonConfig } from '@neondatabase/serverless';
import {
  explainConnectError,
  isLocalHost,
  parseDatabaseUrl,
  proxyDisplay,
  proxyUrlFor,
  type ConnectionInfo,
} from './connect';
import { createProxyAwareFetch, type FetchLike } from './proxy-fetch';

/**
 * Neon HTTP driver for the loader (`--driver http`).
 *
 * Neon's HTTP API (POST https://api.<host>/sql) takes a query or a batch of
 * queries per request and has no session: there is no BEGIN ... COMMIT held
 * open across requests. So this driver offers exactly three operations:
 *
 *   query(text, params)   one statement, its own implicit transaction
 *   readBatch([...])      N statements as ONE READ ONLY, REPEATABLE READ
 *                         transaction: they all see one snapshot
 *   writeBatch([...])     N statements as ONE read-write transaction: they
 *                         commit together or not at all
 *
 * All traffic is plain HTTPS to port 443, tunnelled through HTTPS_PROXY when
 * one applies (see proxy-fetch.ts). No WebSocket is ever opened.
 */

type Row = Record<string, unknown>;

export interface HttpStatement {
  text: string;
  params: unknown[];
}

export interface HttpDb {
  info: ConnectionInfo;
  query(text: string, params?: unknown[]): Promise<Row[]>;
  readBatch(statements: readonly HttpStatement[]): Promise<Row[][]>;
  writeBatch(statements: readonly HttpStatement[]): Promise<Row[][]>;
  /** Requests sent, by route (proxied vs direct). */
  requestStats(): { viaProxy: number; direct: number };
  end(): Promise<void>;
}

/** The API URL the Neon driver will POST to for this database host. */
export function neonEndpointUrl(host: string, port: string): string {
  const endpoint = neonConfig.fetchEndpoint;
  return typeof endpoint === 'function' ? endpoint(host, port) : endpoint;
}

/**
 * The Neon driver reports a failed fetch as "Error connecting to database:
 * TypeError: fetch failed"; the useful part (ENOTFOUND, ECONNREFUSED, a TLS
 * error) is the cause of the error it kept in `sourceError`. Put it in the text.
 */
export function withCause(err: unknown): unknown {
  const source = (err as { sourceError?: unknown } | null)?.sourceError as { cause?: unknown } | undefined;
  const cause = source?.cause as { code?: unknown; message?: unknown } | undefined;
  if (!(err instanceof Error) || !cause) return err;
  const detail = [typeof cause.code === 'string' ? cause.code : '', typeof cause.message === 'string' ? cause.message : ''].filter(Boolean).join(': ');
  return detail && !err.message.includes(detail) ? new Error(`${err.message} (${detail})`) : err;
}

export interface ConnectHttpOptions {
  env?: NodeJS.ProcessEnv;
  /** Replaces the proxy-aware fetch (tests). */
  fetchImpl?: FetchLike;
  /** Extra trusted CA for the proxy tunnel (tests). */
  ca?: string | Buffer;
}

export function connectHttp(url: string, options: ConnectHttpOptions = {}): HttpDb {
  const env = options.env ?? process.env;
  const parsed = parseDatabaseUrl(url);
  if (isLocalHost(parsed.host)) {
    throw new Error(
      `--driver http talks to the Neon HTTP API, which a local Postgres (${parsed.host}) does not have. Use --driver pg for a local database.`,
    );
  }
  const endpointUrl = new URL(neonEndpointUrl(parsed.host, parsed.port));
  const proxyUrl = endpointUrl.protocol === 'https:' ? proxyUrlFor(endpointUrl.hostname, env) : null;
  const info: ConnectionInfo = {
    ...parsed,
    port: endpointUrl.port || (endpointUrl.protocol === 'https:' ? '443' : '80'),
    driver: 'neon-http',
    proxy: proxyUrl ? proxyDisplay(proxyUrl) : null,
    endpoint: endpointUrl.hostname,
  };

  const proxyFetch = createProxyAwareFetch({ env, ca: options.ca });
  // Global on purpose: neon() reads it per request. Nothing else in this
  // process uses the Neon HTTP driver.
  neonConfig.fetchFunction = options.fetchImpl ?? proxyFetch.fetch;
  const sql = neon(url);

  const wrap = async <T>(phase: 'read' | 'write', run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      // A database verdict (SQLSTATE) is passed through untouched; the apply
      // flow classifies it. Anything else is a transport failure: add the
      // operator hints (and strip credentials). For a write the message must
      // not claim the connection failed: the batch may have been received.
      const code = (err as { code?: unknown } | null)?.code;
      if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) throw err;
      throw new Error(explainConnectError(withCause(err), info, url, phase === 'read' ? 'connect' : 'write'));
    }
  };

  return {
    info,
    requestStats: () => ({ ...proxyFetch.stats }),
    query: (text, params = []) => wrap('read', async () => (await sql.query(text, params)) as Row[]),
    readBatch: statements =>
      wrap(
        'read',
        async () =>
          (await sql.transaction(
            statements.map(s => sql.query(s.text, s.params)),
            { isolationLevel: 'RepeatableRead', readOnly: true },
          )) as Row[][],
      ),
    writeBatch: statements =>
      wrap(
        'write',
        async () =>
          (await sql.transaction(
            statements.map(s => sql.query(s.text, s.params)),
            // READ COMMITTED on purpose: every statement then sees what the
            // lock holder before it committed. REPEATABLE READ would pin the
            // snapshot at the lock statement, before any wait for it.
            { isolationLevel: 'ReadCommitted', readOnly: false },
          )) as Row[][],
      ),
    end: async () => proxyFetch.close(),
  };
}
