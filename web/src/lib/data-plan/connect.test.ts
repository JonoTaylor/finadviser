import { describe, expect, it } from 'vitest';
import {
  bypassProxy,
  errorText,
  explainConnectError,
  isLocalHost,
  parseDatabaseUrl,
  proxyUrlFor,
  redactSecrets,
  resolveDriverChoice,
  type ConnectionInfo,
} from './connect';

const info: ConnectionInfo = { host: 'ep-example.neon.tech', port: '5432', database: 'app', driver: 'neon-ws', proxy: null };
const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const URL_WITH_PASSWORD = 'postgresql://app_user:s3cr3t-pw@ep-example.neon.tech/app?sslmode=require';

describe('database URL handling', () => {
  it('extracts host and database without credentials', () => {
    expect(parseDatabaseUrl(URL_WITH_PASSWORD)).toEqual({ host: 'ep-example.neon.tech', port: '5432', database: 'app' });
    expect(parseDatabaseUrl('postgres://u@127.0.0.1:54329/fixture')).toEqual({ host: '127.0.0.1', port: '54329', database: 'fixture' });
  });

  it('rejects things that are not postgres URLs', () => {
    expect(() => parseDatabaseUrl('not a url')).toThrow(/not a valid URL/);
    expect(() => parseDatabaseUrl('https://example.com/db')).toThrow(/must start with postgres/);
  });

  it('recognises only loopback hosts as local', () => {
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '::1']) expect(isLocalHost(h)).toBe(true);
    for (const h of ['ep-example.neon.tech', '127.0.0.2.example.com', 'db.local']) expect(isLocalHost(h)).toBe(false);
  });
});

describe('proxy selection', () => {
  it('matches NO_PROXY entries the usual ways', () => {
    expect(bypassProxy('a.b.neon.tech', '.neon.tech')).toBe(true);
    expect(bypassProxy('a.b.neon.tech', '*.neon.tech')).toBe(true);
    expect(bypassProxy('neon.tech', '.neon.tech')).toBe(true);
    expect(bypassProxy('a.b.neon.tech', 'neon.tech')).toBe(false);
    expect(bypassProxy('x.example.com', 'localhost,*')).toBe(true);
    expect(bypassProxy('x.example.com', 'x.example.com:443')).toBe(true);
    expect(bypassProxy('x.example.com', undefined)).toBe(false);
  });

  it('uses HTTPS_PROXY unless the host is excluded', () => {
    const withProxy = env({ HTTPS_PROXY: 'http://127.0.0.1:3128', NO_PROXY: 'localhost,.internal' });
    expect(proxyUrlFor('ep-example.neon.tech', withProxy)).toBe('http://127.0.0.1:3128');
    expect(proxyUrlFor('db.internal', withProxy)).toBeNull();
    expect(proxyUrlFor('ep-example.neon.tech', env({}))).toBeNull();
    expect(proxyUrlFor('ep-example.neon.tech', env({ https_proxy: 'http://p:1' }))).toBe('http://p:1');
  });
});

describe('error messages never leak credentials', () => {
  it('reads the text out of non-Error rejections such as the WebSocket ErrorEvent', () => {
    expect(errorText(new Error('boom'))).toBe('boom');
    expect(errorText({ message: 'Unexpected server response: 403' })).toBe('Unexpected server response: 403');
    expect(errorText({ error: new Error('inner') })).toBe('inner');
    expect(errorText({ reason: 'closed' })).toBe('closed');
    expect(errorText('plain')).toBe('plain');
    expect(explainConnectError({ message: 'Unexpected server response: 403' }, info, URL_WITH_PASSWORD)).toContain('Unexpected server response: 403');
  });

  it('redacts the URL and the password', () => {
    const out = redactSecrets(`failed for ${URL_WITH_PASSWORD}: password s3cr3t-pw rejected`, URL_WITH_PASSWORD);
    expect(out).not.toContain('s3cr3t-pw');
    expect(out).not.toContain('app_user');
    expect(out).toContain('<DATABASE_URL>');
  });

  it('explains common connection failures with an actionable hint', () => {
    const enotfound = Object.assign(new Error('getaddrinfo ENOTFOUND ep-example.neon.tech'), { code: 'ENOTFOUND' });
    const msg = explainConnectError(enotfound, info, URL_WITH_PASSWORD);
    expect(msg).toContain('Could not connect to ep-example.neon.tech');
    expect(msg).toContain('HTTPS_PROXY');

    const upgrade = explainConnectError(new Error('Unexpected server response: 403'), { ...info, proxy: '127.0.0.1:45833' }, URL_WITH_PASSWORD);
    expect(upgrade).toContain('WebSocket upgrade was refused');
    expect(upgrade).toContain('via proxy 127.0.0.1:45833');

    const tls = explainConnectError(new Error('self-signed certificate in certificate chain'), info, URL_WITH_PASSWORD);
    expect(tls).toContain('NODE_EXTRA_CA_CERTS');

    const auth = explainConnectError(new Error(`password authentication failed for user "app_user" (${URL_WITH_PASSWORD})`), info, URL_WITH_PASSWORD);
    expect(auth).not.toContain('s3cr3t-pw');
    expect(auth).toContain('rejected the credentials');
  });
});

describe('driver choice', () => {
  it('the --driver flag wins, then DATA_PLAN_DRIVER, then auto', () => {
    expect(resolveDriverChoice(null, env({}))).toBe('auto');
    expect(resolveDriverChoice(undefined, env({ DATA_PLAN_DRIVER: 'http' }))).toBe('http');
    expect(resolveDriverChoice('pg', env({ DATA_PLAN_DRIVER: 'http' }))).toBe('pg');
    expect(resolveDriverChoice('HTTP', env({}))).toBe('http');
    expect(resolveDriverChoice('neon', env({}))).toBe('neon');
  });

  it('an explicit "auto" still lets DATA_PLAN_DRIVER decide (auto means "not chosen")', () => {
    expect(resolveDriverChoice('auto', env({ DATA_PLAN_DRIVER: 'http' }))).toBe('http');
    expect(resolveDriverChoice('auto', env({}))).toBe('auto');
    expect(resolveDriverChoice(null, env({ DATA_PLAN_DRIVER: '  ' }))).toBe('auto');
  });

  it('rejects unknown values, naming where they came from', () => {
    expect(() => resolveDriverChoice('websocket', env({}))).toThrow(/--driver must be one of auto, pg, neon, http \(got "websocket"\)/);
    expect(() => resolveDriverChoice(null, env({ DATA_PLAN_DRIVER: 'bogus' }))).toThrow(/DATA_PLAN_DRIVER must be one of/);
  });
});

describe('HTTP driver error messages', () => {
  const http: ConnectionInfo = { host: 'ep-example.neon.tech', port: '443', database: 'app', driver: 'neon-http', proxy: '127.0.0.1:45833', endpoint: 'api.neon.tech' };

  it('names the API host, the driver and the proxy', () => {
    const msg = explainConnectError(new Error('Error connecting to database: Error: socket hang up'), http, URL_WITH_PASSWORD);
    expect(msg).toContain('Could not connect to api.neon.tech:443 (neon-http via proxy 127.0.0.1:45833)');
    expect(msg).toContain('plain HTTPS');
    expect(msg).not.toContain('WebSocket upgrade is allowed');
  });

  it('a write that dropped does not claim it never arrived', () => {
    const msg = explainConnectError(new Error('Error connecting to database: Error: socket hang up'), http, URL_WITH_PASSWORD, 'write');
    expect(msg).toContain('The write request to api.neon.tech:443');
    expect(msg).toContain('may or may not have been received');
  });

  it('explains proxy / API status codes', () => {
    expect(explainConnectError(new Error('Server error (HTTP status 403): '), http, URL_WITH_PASSWORD)).toContain('egress policy');
    expect(explainConnectError(new Error('Server error (HTTP status 502): bad gateway'), http, URL_WITH_PASSWORD, 'write')).toContain('outcome of the write is not known');
    expect(explainConnectError(new Error('Server error (HTTP status 502): bad gateway'), http, URL_WITH_PASSWORD)).toContain('a read changes nothing');
  });

  it('suggests HTTPS_PROXY (not the WebSocket) when the name does not resolve', () => {
    const msg = explainConnectError(new Error('getaddrinfo ENOTFOUND api.neon.tech'), { ...http, proxy: null }, URL_WITH_PASSWORD);
    expect(msg).toContain('requests are then tunnelled through it');
    expect(msg).not.toContain('WebSocket');
  });

  it('never leaks the password', () => {
    const msg = explainConnectError(new Error(`failed: ${URL_WITH_PASSWORD}`), http, URL_WITH_PASSWORD, 'write');
    expect(msg).not.toContain('s3cr3t-pw');
  });
});
