import { SignJWT, jwtVerify } from 'jose';
import bcrypt from 'bcryptjs';
import { env } from '@/lib/env';

// Personal-app auth: a single password (bcrypt-hashed in the env) and a
// signed JWT issued as an httpOnly cookie. No user table — this is a
// one-owner app.
//
// Service accounts (CI, scripts, MCP) authenticate via the separate
// API_AUTH_TOKEN bearer header — see middleware.ts.

export const SESSION_COOKIE = 'finadviser_session';
const DEFAULT_TTL = 60 * 60 * 24 * 30; // 30 days

function secretKey(): Uint8Array {
  const secret = env().AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured');
  return new TextEncoder().encode(secret);
}

export function sessionTtlSeconds(): number {
  return env().SESSION_TTL_SECONDS ?? DEFAULT_TTL;
}

export async function verifyPassword(plain: string): Promise<boolean> {
  const hash = env().APP_PASSWORD_HASH;
  if (!hash) return false;
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export interface SessionPayload {
  sub: 'owner';
  iat: number;
  exp: number;
}

export async function issueSessionToken(): Promise<string> {
  const ttl = sessionTtlSeconds();
  return new SignJWT({ sub: 'owner' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ttl}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ['HS256'] });
    if (payload.sub !== 'owner' || typeof payload.exp !== 'number') return null;
    return payload as unknown as SessionPayload;
  } catch {
    return null;
  }
}

// Edge-runtime variant: accepts the secret string directly so middleware
// can call it without pulling the full env() chain.
export async function verifySessionTokenWith(
  token: string,
  secret: string,
): Promise<boolean> {
  if (!token || !secret) return false;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    return payload.sub === 'owner';
  } catch {
    return false;
  }
}
