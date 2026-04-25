/**
 * Lightweight session-cookie auth for a single-household app.
 *
 * Cookie format: 'v1.<issued_ms>.<hmac_hex>'
 *   issued_ms — milliseconds since epoch when the session was created
 *   hmac_hex  — HMAC-SHA256 of 'v1.<issued_ms>' with SESSION_SECRET
 *
 * No DB; the server doesn't need to remember anything. Logout invalidates
 * the cookie at the browser. To revoke globally, rotate SESSION_SECRET in
 * Vercel — every existing cookie will fail verification.
 *
 * Uses the Web Crypto API (globalThis.crypto.subtle) so the same code runs
 * in the Edge middleware and the Node API routes.
 */

const COOKIE_NAME = 'finadviser_session';
const COOKIE_VERSION = 'v1';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface AuthConfig {
  password: string | undefined;
  secret: string | undefined;
}

export function readAuthConfig(): AuthConfig {
  return {
    password: process.env.APP_PASSWORD,
    secret: process.env.SESSION_SECRET,
  };
}

/**
 * Production must have both APP_PASSWORD and SESSION_SECRET set or every
 * request will be denied. Local dev (NODE_ENV !== 'production') allows the
 * unconfigured case so devs aren't blocked from running the app.
 */
export function isAuthEnabled(cfg: AuthConfig = readAuthConfig()): boolean {
  if (cfg.password && cfg.secret) return true;
  if (process.env.NODE_ENV === 'production') return true; // fail-closed in prod
  return false;
}

const enc = new TextEncoder();

async function hmacSign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bufToHex(sig);
}

async function hmacVerify(secret: string, data: string, hex: string): Promise<boolean> {
  // Recompute and compare in constant time to prevent timing attacks.
  const expected = await hmacSign(secret, data);
  if (expected.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= expected.charCodeAt(i) ^ hex.charCodeAt(i);
  }
  return diff === 0;
}

function bufToHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 1) {
    s += bytes[i].toString(16).padStart(2, '0');
  }
  return s;
}

export async function createSessionCookie(secret: string, now = Date.now()): Promise<string> {
  const payload = `${COOKIE_VERSION}.${now}`;
  const sig = await hmacSign(secret, payload);
  return `${payload}.${sig}`;
}

export async function verifySessionCookie(
  secret: string,
  cookieValue: string | undefined,
  now = Date.now(),
): Promise<boolean> {
  if (!cookieValue) return false;
  const parts = cookieValue.split('.');
  if (parts.length !== 3) return false;
  const [version, issuedMs, sig] = parts;
  if (version !== COOKIE_VERSION) return false;
  const issued = Number(issuedMs);
  if (!Number.isFinite(issued)) return false;
  if (now - issued > MAX_AGE_MS) return false;
  if (now - issued < -60_000) return false; // minor clock-skew tolerance
  return hmacVerify(secret, `${version}.${issuedMs}`, sig);
}

/**
 * Constant-time string equality for password comparison. Prevents timing
 * attacks even though there's only one user — costs nothing to do right.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const SESSION_COOKIE_NAME = COOKIE_NAME;
export const SESSION_MAX_AGE_SECONDS = Math.floor(MAX_AGE_MS / 1000);
