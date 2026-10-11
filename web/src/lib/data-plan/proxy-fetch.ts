import { request as httpRequest } from 'node:http';
import { request as httpsRequest, type Agent as HttpsAgent } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { proxyUrlFor } from './connect';

/**
 * A fetch() for the Neon HTTP driver that goes through an HTTPS CONNECT proxy
 * when one is configured.
 *
 * Why not just rely on Node: the built-in fetch ignores HTTPS_PROXY unless the
 * process was started with NODE_USE_ENV_PROXY=1 (Node >= 22.21 / 24.x); that
 * is a start-up switch, so a script cannot turn it on for itself, and on an
 * older Node it is silently ignored and the request goes straight out and
 * fails. undici's ProxyAgent is not a dependency here. This function needs
 * neither: the Neon driver lets us supply its own `fetchFunction`
 * (neonConfig.fetchFunction), and for every request it decides, from the
 * target host, HTTPS_PROXY and NO_PROXY, whether to tunnel:
 *
 *   - proxy applies  -> node:https with an https-proxy-agent (CONNECT tunnel,
 *                       then TLS to the real host through it)
 *   - no proxy       -> the global fetch, unchanged (which still honours
 *                       NODE_USE_ENV_PROXY=1 if the operator set it)
 *
 * TLS verification stays on. The tunnelled TLS session is verified against
 * Node's trust store, which includes NODE_EXTRA_CA_CERTS (how a sandbox proxy
 * that re-signs TLS is trusted). Nothing here disables verification.
 *
 * Only plain HTTPS POSTs to the Neon API pass through here, so the response
 * is buffered whole; no streaming and no HTTP/2.
 */

export interface FetchInitLike {
  method?: string;
  headers?: Record<string, string>;
  body?: string | null;
  signal?: AbortSignal | null;
}

export type FetchLike = (url: string | URL, init?: FetchInitLike) => Promise<Response>;

export interface ProxyAwareFetch {
  fetch: FetchLike;
  /** Requests sent so far, by route. */
  stats: { viaProxy: number; direct: number };
  /** Destroy any sockets still open so the process can exit. */
  close(): void;
}

export interface ProxyAwareFetchOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Trust ONLY these CA(s) for the tunnelled TLS session (tests). It replaces
   * Node's default roots; production leaves it unset and relies on the default
   * store plus NODE_EXTRA_CA_CERTS.
   */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Idle timeout per request. Default 120 s (a write batch is one request). */
  timeoutMs?: number;
}

function decode(body: Buffer, encoding: string | undefined): Buffer {
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
      return gunzipSync(body);
    case 'deflate':
      return inflateSync(body);
    case 'br':
      return brotliDecompressSync(body);
    default:
      return body;
  }
}

function sendRequest(url: URL, init: FetchInitLike, agent: HttpsAgent | undefined, timeoutMs: number, ca: ProxyAwareFetchOptions['ca']): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const send = url.protocol === 'http:' ? httpRequest : httpsRequest;
    const body = init.body ?? undefined;
    const headers: Record<string, string> = { ...(init.headers ?? {}) };
    if (body !== undefined && !Object.keys(headers).some(h => h.toLowerCase() === 'content-length')) {
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    // https-proxy-agent takes the TLS options for the tunnelled session from the request, not from its own constructor.
    const req = send(url, { method: init.method ?? 'GET', headers, agent, ...(ca ? { ca } : {}) }, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('error', reject);
      res.on('end', () => {
        try {
          const status = res.statusCode ?? 0;
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(res.headers)) {
            if (value === undefined) continue;
            for (const v of Array.isArray(value) ? value : [value]) responseHeaders.append(name, v);
          }
          const nullBody = status === 204 || status === 205 || status === 304;
          const payload = nullBody ? null : decode(Buffer.concat(chunks), res.headers['content-encoding']);
          // The body is already decoded: drop the headers that describe the encoded one.
          responseHeaders.delete('content-encoding');
          responseHeaders.delete('content-length');
          resolve(new Response(payload === null ? null : new Uint8Array(payload), { status, statusText: res.statusMessage ?? '', headers: responseHeaders }));
        } catch (err) {
          reject(err);
        }
      });
    });
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`request to ${url.host} timed out after ${Math.round(timeoutMs / 1000)}s`)));
    req.on('error', reject);
    const signal = init.signal;
    if (signal) {
      if (signal.aborted) {
        req.destroy(new Error('aborted'));
      } else {
        signal.addEventListener('abort', () => req.destroy(new Error('aborted')), { once: true });
      }
    }
    if (body !== undefined) req.write(body);
    req.end();
  });
}

export function createProxyAwareFetch(options: ProxyAwareFetchOptions = {}): ProxyAwareFetch {
  const env = options.env ?? process.env;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const agents = new Map<string, HttpsProxyAgent<string>>();
  const stats = { viaProxy: 0, direct: 0 };

  const agentFor = (proxyUrl: string): HttpsProxyAgent<string> => {
    let agent = agents.get(proxyUrl);
    if (!agent) {
      // No keep-alive, on purpose: a run makes a handful of requests, and a
      // reused socket the far end has just closed would fail a write with a
      // reset whose outcome is then unknown. A fresh tunnel per request costs
      // milliseconds and rules that out.
      agent = new HttpsProxyAgent(proxyUrl, { keepAlive: false });
      agents.set(proxyUrl, agent);
    }
    return agent;
  };

  const doFetch: FetchLike = async (input, init = {}) => {
    const url = new URL(String(input));
    const proxy = url.protocol === 'https:' ? proxyUrlFor(url.hostname, env) : null;
    if (!proxy) {
      stats.direct += 1;
      return globalThis.fetch(url, init as RequestInit);
    }
    stats.viaProxy += 1;
    return sendRequest(url, init, agentFor(proxy), timeoutMs, options.ca);
  };

  return {
    fetch: doFetch,
    stats,
    close: () => {
      for (const agent of agents.values()) agent.destroy();
      agents.clear();
    },
  };
}
