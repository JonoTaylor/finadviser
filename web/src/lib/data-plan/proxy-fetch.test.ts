import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net, { type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createProxyAwareFetch } from './proxy-fetch';

/**
 * Real sockets, no mocks: an HTTPS server (cert from a throwaway CA made with
 * the openssl CLI), a CONNECT proxy that records every tunnel, and the
 * proxy-aware fetch pointed at them. Skipped where openssl is not installed.
 */
function haveOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const env = (vars: Record<string, string>) => vars as unknown as NodeJS.ProcessEnv;
const sockets = new Set<net.Socket>();
const listen = (server: net.Server) => {
  server.on('connection', s => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  return new Promise<number>(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
};
/** Close a server, first dropping any connection a test left open (a request that was never answered). */
const close = (server: net.Server) =>
  new Promise<void>(resolve => {
    server.close(() => resolve());
    for (const s of sockets) s.destroy();
  });

describe.skipIf(!haveOpenssl())('proxy-aware fetch', () => {
  let dir: string;
  let ca: string;
  let origin: https.Server;
  let originPort: number;
  let proxy: http.Server;
  let proxyPort: number;
  const tunnels: string[] = [];
  const seen: Array<{ method?: string; url?: string; auth?: string; body: string }> = [];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'proxy-fetch-test-'));
    const run = (...args: string[]) => execFileSync('openssl', args, { cwd: dir, stdio: 'ignore' });
    run('req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'ca.key', '-out', 'ca.pem', '-subj', '/CN=Test CA', '-days', '2');
    run('req', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', 'srv.key', '-out', 'srv.csr', '-subj', '/CN=api.example.test');
    writeFileSync(join(dir, 'san.cnf'), 'subjectAltName=DNS:api.example.test,IP:127.0.0.1\n');
    run('x509', '-req', '-in', 'srv.csr', '-CA', 'ca.pem', '-CAkey', 'ca.key', '-CAcreateserial', '-out', 'srv.pem', '-days', '2', '-extfile', 'san.cnf');
    ca = readFileSync(join(dir, 'ca.pem'), 'utf8');

    origin = https.createServer({ key: readFileSync(join(dir, 'srv.key')), cert: readFileSync(join(dir, 'srv.pem')) }, (req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        seen.push({ method: req.method, url: req.url, auth: req.headers['neon-connection-string'] as string | undefined, body });
        if (req.url === '/hang') return; // never answer
        if (req.url === '/gzip') {
          res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
          return void res.end(gzipSync(JSON.stringify({ zipped: true })));
        }
        if (req.url === '/bad') {
          res.writeHead(400, { 'content-type': 'application/json' });
          return void res.end(JSON.stringify({ message: 'nope', code: '22P02' }));
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ echo: body.length ? JSON.parse(body) : null }));
      });
    });
    originPort = await listen(origin);

    // A CONNECT proxy: records the target, refuses *.blocked.example.test, tunnels everything else to the origin.
    proxy = http.createServer((_req, res) => {
      res.writeHead(405);
      res.end();
    });
    proxy.on('connect', (req, client, head) => {
      tunnels.push(req.url ?? '');
      const host = (req.url ?? '').split(':')[0];
      if (host.endsWith('blocked.example.test')) {
        client.end('HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n');
        return;
      }
      const upstream = net.connect(originPort, '127.0.0.1', () => {
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        upstream.write(head);
        upstream.pipe(client);
        client.pipe(upstream);
      });
      upstream.on('error', () => client.destroy());
      client.on('error', () => upstream.destroy());
    });
    proxyPort = await listen(proxy);
  });

  afterAll(async () => {
    await Promise.all([close(origin), close(proxy)]);
    rmSync(dir, { recursive: true, force: true });
  });

  const viaProxy = () => createProxyAwareFetch({ env: env({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` }), ca });

  it('tunnels an HTTPS POST through the CONNECT proxy and returns a normal Response', async () => {
    const f = viaProxy();
    tunnels.length = 0;
    const res = await f.fetch(`https://api.example.test:${originPort}/sql`, {
      method: 'POST',
      headers: { 'Neon-Connection-String': 'postgres://u:p@h/db', 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'SELECT 1', params: [] }),
    });
    expect(res.ok).toBe(true);
    expect(await res.json()).toEqual({ echo: { query: 'SELECT 1', params: [] } });
    expect(tunnels).toEqual([`api.example.test:${originPort}`]);
    expect(f.stats).toEqual({ viaProxy: 1, direct: 0 });
    expect(seen[seen.length - 1]).toMatchObject({ method: 'POST', url: '/sql', auth: 'postgres://u:p@h/db' });
    f.close();
  });

  it('opens a fresh tunnel for every request (no stale keep-alive socket can fail a write)', async () => {
    const f = viaProxy();
    tunnels.length = 0;
    for (let i = 0; i < 3; i++) await (await f.fetch(`https://api.example.test:${originPort}/sql`, { method: 'POST', body: '{}' })).json();
    expect(tunnels).toHaveLength(3);
    expect(f.stats.viaProxy).toBe(3);
    f.close();
  });

  it('returns non-2xx answers as responses, for the caller to interpret', async () => {
    const f = viaProxy();
    const bad = await f.fetch(`https://api.example.test:${originPort}/bad`, { method: 'POST', body: '{}' });
    expect(bad.status).toBe(400);
    expect(bad.ok).toBe(false);
    expect(await bad.json()).toEqual({ message: 'nope', code: '22P02' });
    f.close();
  });

  it('decodes a compressed body', async () => {
    const f = viaProxy();
    const res = await f.fetch(`https://api.example.test:${originPort}/gzip`, { method: 'POST', body: '{}' });
    expect(await res.json()).toEqual({ zipped: true });
    f.close();
  });

  it('keeps TLS verification on: a host that is not in the certificate is rejected', async () => {
    const f = viaProxy();
    await expect(f.fetch(`https://other.example.test:${originPort}/sql`, { method: 'POST', body: '{}' })).rejects.toThrow(/altnames|not in the cert|Hostname/i);
    f.close();
  });

  it('keeps TLS verification on: a certificate from an unknown CA is rejected', async () => {
    const f = createProxyAwareFetch({ env: env({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` }) }); // no `ca`
    await expect(f.fetch(`https://api.example.test:${originPort}/sql`, { method: 'POST', body: '{}' })).rejects.toThrow(/certificate|self.signed|unable to verify/i);
    f.close();
  });

  it('shows the proxy\'s refusal (403 to CONNECT) as an HTTP 403', async () => {
    const f = viaProxy();
    const res = await f.fetch(`https://api.blocked.example.test:${originPort}/sql`, { method: 'POST', body: '{}' }).catch(e => e as Error);
    // https-proxy-agent replays the proxy's refusal as the response; some versions surface it as an error instead
    if (res instanceof Error) expect(res.message).toMatch(/403|proxy|socket/i);
    else expect(res.status).toBe(403);
    f.close();
  });

  it('does not use the proxy for a host NO_PROXY excludes', async () => {
    const f = createProxyAwareFetch({ env: env({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}`, NO_PROXY: '127.0.0.1' }), ca });
    tunnels.length = 0;
    const res = await f.fetch(`https://127.0.0.1:${originPort}/sql`, { method: 'POST', body: '{}' }).catch(e => e as Error);
    expect(tunnels).toEqual([]);
    expect(f.stats).toEqual({ viaProxy: 0, direct: 1 });
    expect(res).toBeDefined();
    f.close();
  });

  it('does not use the proxy when none is configured, nor for plain http', async () => {
    const plain = http.createServer((_req, res) => res.end('{"plain":true}'));
    const port = await listen(plain);
    const f = createProxyAwareFetch({ env: env({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` }), ca });
    tunnels.length = 0;
    expect(await (await f.fetch(`http://127.0.0.1:${port}/`, { method: 'POST', body: '{}' })).json()).toEqual({ plain: true });
    expect(tunnels).toEqual([]);
    expect(f.stats).toEqual({ viaProxy: 0, direct: 1 });
    f.close();
    await close(plain);
  });

  it('gives up on a request that is never answered', async () => {
    const f = createProxyAwareFetch({ env: env({ HTTPS_PROXY: `http://127.0.0.1:${proxyPort}` }), ca, timeoutMs: 300 });
    await expect(f.fetch(`https://api.example.test:${originPort}/hang`, { method: 'POST', body: '{}' })).rejects.toThrow(/timed out/);
    f.close();
  });

  it('honours an abort signal', async () => {
    const f = viaProxy();
    const controller = new AbortController();
    const pending = f.fetch(`https://api.example.test:${originPort}/hang`, { method: 'POST', body: '{}', signal: controller.signal });
    setTimeout(() => controller.abort(), 100);
    await expect(pending).rejects.toThrow(/aborted/);
    f.close();
  });
});
