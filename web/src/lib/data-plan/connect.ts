import { Client as NeonClient, neonConfig } from '@neondatabase/serverless';
import { Client as PgClient } from 'pg';
import { HttpsProxyAgent } from 'https-proxy-agent';
import ws from 'ws';
import type { Queryable, QueryResult } from './statements';

/**
 * Database access for the loader, behind a tiny query(text, params) surface.
 *
 *   - Neon (production) is reached over WSS on port 443 with the Neon
 *     serverless `Client`, exactly like scripts/migrate.mjs. The `ws`
 *     package does NOT honour HTTPS_PROXY by itself, so when a proxy is
 *     configured (and the host is not in NO_PROXY) the WebSocket is opened
 *     through an HTTP CONNECT tunnel.
 *   - A plain local Postgres (localhost / 127.0.0.1) cannot speak the Neon
 *     WebSocket protocol, so it uses `pg`. Used by the local test harness.
 *   - `http` (see http.ts) is for networks that only allow plain HTTPS
 *     through a CONNECT proxy and refuse WebSocket upgrades. It cannot hold
 *     an interactive transaction, so it is not a DbConnection and is not
 *     created here; this module only decides when to use it.
 */

/** Drivers that give an interactive connection (BEGIN ... COMMIT on one session). */
export type TxDriverChoice = 'auto' | 'pg' | 'neon';
export type DriverChoice = TxDriverChoice | 'http';
export const DRIVER_CHOICES: readonly DriverChoice[] = ['auto', 'pg', 'neon', 'http'];

/**
 * The driver to use: `--driver` if it names one, otherwise DATA_PLAN_DRIVER
 * from the environment (so a runner can pick `http` once, for every command),
 * otherwise `auto`. Throws a usage-style Error for an unknown value.
 */
export function resolveDriverChoice(cliValue: string | null | undefined, env: NodeJS.ProcessEnv = process.env): DriverChoice {
  const pick = (value: string, where: string): DriverChoice => {
    const v = value.trim().toLowerCase();
    if ((DRIVER_CHOICES as readonly string[]).includes(v)) return v as DriverChoice;
    throw new Error(`${where} must be one of ${DRIVER_CHOICES.join(', ')} (got "${value}")`);
  };
  if (cliValue && cliValue.trim().toLowerCase() !== 'auto') return pick(cliValue, '--driver');
  const fromEnv = env.DATA_PLAN_DRIVER;
  if (fromEnv && fromEnv.trim() !== '') return pick(fromEnv, 'DATA_PLAN_DRIVER');
  return 'auto';
}

export interface ConnectionInfo {
  host: string;
  port: string;
  database: string;
  driver: 'pg' | 'neon-ws' | 'neon-http';
  /** host:port of the proxy the WebSocket / HTTPS requests are tunnelled through, if any. Never includes credentials. */
  proxy: string | null;
  /** neon-http only: the API host the requests go to (derived from the database host). */
  endpoint?: string;
}

export interface DbConnection extends Queryable {
  info: ConnectionInfo;
  end(): Promise<void>;
}

export function parseDatabaseUrl(url: string): { host: string; port: string; database: string } {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error('DATABASE_URL is not a valid URL (expected postgres://user:password@host/dbname)');
  }
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') {
    throw new Error(`DATABASE_URL must start with postgres:// or postgresql:// (got "${u.protocol}//")`);
  }
  return {
    host: u.hostname.replace(/^\[|\]$/g, ''),
    port: u.port || '5432',
    database: decodeURIComponent(u.pathname.replace(/^\//, '')),
  };
}

export function isLocalHost(host: string): boolean {
  const h = host.toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}

/** NO_PROXY matching: exact host, ".suffix", "*.suffix" or "*". */
export function bypassProxy(host: string, noProxy: string | undefined): boolean {
  if (!noProxy) return false;
  const h = host.toLowerCase();
  return noProxy
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
    .some(entry => {
      if (entry === '*') return true;
      const bare = entry.replace(/:\d+$/, '').replace(/^\*/, '');
      if (bare.startsWith('.')) return h.endsWith(bare) || h === bare.slice(1);
      return h === bare;
    });
}

/** The proxy URL to tunnel through for this host, or null for a direct connection. */
export function proxyUrlFor(host: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const proxy = env.HTTPS_PROXY ?? env.https_proxy ?? null;
  if (!proxy) return null;
  if (bypassProxy(host, env.NO_PROXY ?? env.no_proxy)) return null;
  return proxy;
}

export function proxyDisplay(proxyUrl: string): string {
  try {
    const u = new URL(proxyUrl);
    return `${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
  } catch {
    return '(unparseable proxy URL)';
  }
}

/** A `ws` subclass that opens every WebSocket through the given proxy agent. */
function webSocketThrough(proxyUrl: string): typeof ws {
  const agent = new HttpsProxyAgent(proxyUrl);
  class ProxiedWebSocket extends ws {
    constructor(address: string | URL, a?: string | string[] | ws.ClientOptions, b?: ws.ClientOptions) {
      const protocols = typeof a === 'string' || Array.isArray(a) ? a : undefined;
      const options = (typeof a === 'string' || Array.isArray(a) ? b : a) ?? {};
      super(address, protocols, { handshakeTimeout: 20_000, ...options, agent });
    }
  }
  // ws also types a server-side constructor overload (address: null) that a
  // subclass cannot repeat; the Neon driver only ever calls new WebSocket(url).
  return ProxiedWebSocket as unknown as typeof ws;
}

/**
 * Text of whatever a driver rejected with. The Neon WebSocket client rejects
 * with an ErrorEvent (not an Error) when the handshake fails, which would
 * otherwise print as "[object Object]".
 */
export function errorText(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; error?: unknown; reason?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (o.error) return errorText(o.error);
    if (typeof o.reason === 'string' && o.reason) return o.reason;
  }
  return String(err);
}

/** Remove anything credential-like from an error message before printing it. */
export function redactSecrets(message: string, url: string): string {
  let out = message.split(url).join('<DATABASE_URL>');
  try {
    const u = new URL(url);
    if (u.password) out = out.split(decodeURIComponent(u.password)).join('***').split(u.password).join('***');
  } catch {
    // not a URL; nothing more to redact
  }
  return out;
}

/** Turn a low-level connection failure into something the operator can act on. */
export function explainConnectError(err: unknown, info: ConnectionInfo, url: string, phase: 'connect' | 'write' = 'connect'): string {
  const raw = errorText(err);
  const code = (err as { code?: string } | null)?.code ?? '';
  const message = redactSecrets(raw, url);
  const target = info.driver === 'neon-http' && info.endpoint ? info.endpoint : info.host;
  const where = `${target}:${info.port} (${info.driver}${info.proxy ? ` via proxy ${info.proxy}` : ''})`;
  const hints: string[] = [];

  if (code === 'ENOTFOUND' || /ENOTFOUND|getaddrinfo/i.test(raw)) {
    hints.push(
      info.proxy
        ? 'The proxy could not resolve the host, or DNS is blocked. Check the host in DATABASE_URL.'
        : info.driver === 'neon-http'
          ? 'DNS could not resolve the host. If this machine reaches the internet through an HTTPS proxy, set HTTPS_PROXY: the requests are then tunnelled through it.'
          : 'DNS could not resolve the host. If this machine reaches the internet through an HTTPS proxy, set HTTPS_PROXY: the WebSocket is then tunnelled through it (the ws library ignores the variable on its own).',
    );
  }
  if (/\b407\b|Proxy Authentication/i.test(raw)) hints.push('The proxy wants credentials: put them in HTTPS_PROXY (http://user:pass@host:port).');
  if (info.driver === 'neon-http') {
    if (/HTTP status 5\d\d/.test(raw)) {
      hints.push(
        phase === 'write'
          ? 'A 5xx came back from the proxy or the Neon API, not from Postgres, so the outcome of the write is not known from this reply.'
          : 'A 5xx came back from the proxy or the Neon API, not from Postgres. Wait and retry; a read changes nothing.',
      );
    }
    if (/HTTP status 40[137]/.test(raw)) {
      hints.push('A 401/403/407 came back from the proxy or the Neon API: check the credentials in DATABASE_URL, and that the egress policy allows the API host shown above on port 443.');
    }
  }
  if (/\b403\b/.test(raw) && info.proxy) hints.push('The proxy answered 403: the egress policy does not allow this host. Ask for it to be allow-listed; do not retry.');
  if (/Unexpected server response/i.test(raw)) {
    hints.push(
      'The WebSocket upgrade was refused (an HTTP status came back instead of 101). A gateway or proxy that does not pass WebSocket upgrades will do this; run the loader from a network that can open wss:// to Neon on port 443.',
    );
  }
  if (/certificate|self[- ]signed|UNABLE_TO_VERIFY|CERT_/i.test(raw)) {
    hints.push('TLS verification failed. If a corporate/sandbox proxy re-signs TLS, point NODE_EXTRA_CA_CERTS at its CA bundle. Never disable verification.');
  }
  if (/ECONNRESET|socket hang up|ECONNREFUSED|ETIMEDOUT|timeout/i.test(raw) || ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT'].includes(code)) {
    hints.push(
      phase === 'write'
        ? 'The connection dropped or timed out while the write was in flight, so it may or may not have been received.'
        : info.driver === 'neon-http'
          ? 'The connection was refused, reset or timed out before the API answered. Check the host, that the proxy permits CONNECT to it on port 443, and that nothing blocks plain HTTPS.'
          : 'The connection was refused, reset or timed out before the database answered. Check the host and port, that the proxy permits CONNECT to it on 443, and that the WebSocket upgrade is allowed.',
    );
  }
  if (/password authentication failed|no pg_hba|authentication/i.test(raw)) hints.push('The database rejected the credentials in DATABASE_URL.');

  const lead = phase === 'write' ? 'The write request to' : 'Could not connect to';
  return [`${lead} ${where}: ${message}`, ...hints.map(h => `  hint: ${h}`)].join('\n');
}

export async function connect(
  url: string,
  options: { driver?: TxDriverChoice; env?: NodeJS.ProcessEnv } = {},
): Promise<DbConnection> {
  const env = options.env ?? process.env;
  const parsed = parseDatabaseUrl(url);
  const choice = options.driver ?? 'auto';
  const driver: 'pg' | 'neon-ws' =
    choice === 'pg' ? 'pg' : choice === 'neon' ? 'neon-ws' : isLocalHost(parsed.host) ? 'pg' : 'neon-ws';

  const proxyUrl = driver === 'neon-ws' ? proxyUrlFor(parsed.host, env) : null;
  const info: ConnectionInfo = {
    ...parsed,
    // The Neon client always talks WSS on 443, whatever the URL's postgres port says.
    port: driver === 'neon-ws' ? '443' : parsed.port,
    driver,
    proxy: proxyUrl ? proxyDisplay(proxyUrl) : null,
  };

  if (driver === 'pg') {
    const client = new PgClient({ connectionString: url, connectionTimeoutMillis: 20_000 });
    try {
      await client.connect();
    } catch (err) {
      throw new Error(explainConnectError(err, info, url));
    }
    return {
      info,
      query: async <R extends object = Record<string, unknown>>(text: string, params?: unknown[]) => {
        const r = await client.query(text, params as unknown[] | undefined);
        return { rows: r.rows as R[], rowCount: r.rowCount } satisfies QueryResult<R>;
      },
      end: () => client.end(),
    };
  }

  // Same wiring as scripts/migrate.mjs, plus the proxy tunnel when needed.
  neonConfig.webSocketConstructor = proxyUrl ? webSocketThrough(proxyUrl) : ws;
  const client = new NeonClient({ connectionString: url, connectionTimeoutMillis: 20_000 });
  // A socket error after connect would otherwise be an unhandled 'error' event.
  client.on('error', err => {
    console.error(`[db] connection error: ${redactSecrets(errorText(err), url)}`);
  });
  try {
    await client.connect();
  } catch (err) {
    throw new Error(explainConnectError(err, info, url));
  }
  return {
    info,
    query: async <R extends object = Record<string, unknown>>(text: string, params?: unknown[]) => {
      const r = await client.query(text, params as unknown[] | undefined);
      return { rows: r.rows as R[], rowCount: r.rowCount } satisfies QueryResult<R>;
    },
    end: () => client.end(),
  };
}
