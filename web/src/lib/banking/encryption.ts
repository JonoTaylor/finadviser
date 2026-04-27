/**
 * Symmetric envelope encryption for at-rest sensitive values on
 * `connections.encrypted_secret`.
 *
 * Used by future aggregators (TrueLayer) that require per-user OAuth
 * refresh tokens. GoCardless BAD doesn't need this — its only
 * persisted handle is the requisition_id, which is not a credential.
 * The helper exists in PR A so adding TrueLayer later is a wiring
 * change, not a migration + key-rotation exercise.
 *
 * Algorithm: AES-256-GCM with a 12-byte IV, 16-byte auth tag, key
 * loaded from `process.env.TOKEN_ENCRYPTION_KEY` as a 64-char hex
 * string (32 raw bytes). The output buffer layout is
 *   [IV (12)] [CIPHERTEXT (...)] [TAG (16)]
 * stored directly in the BYTEA column.
 *
 * Key rotation: if the env key changes, existing rows can no longer
 * be decrypted. Either re-issue all stored secrets (preferred for
 * personal-app scope) or evolve to a (key_version, ciphertext) layout
 * before introducing rotation.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const KEY_BYTES = 32;

function loadKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) {
    throw new Error('TOKEN_ENCRYPTION_KEY missing from env (generate with: openssl rand -hex 32)');
  }
  if (hex.length !== KEY_BYTES * 2) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must be ${KEY_BYTES * 2} hex characters (got ${hex.length})`);
  }
  const buf = Buffer.from(hex, 'hex');
  if (buf.length !== KEY_BYTES) {
    throw new Error(`TOKEN_ENCRYPTION_KEY decoded to ${buf.length} bytes, expected ${KEY_BYTES}`);
  }
  return buf;
}

export function encryptSecret(plaintext: string): Buffer {
  const key = loadKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]);
}

export function decryptSecret(buf: Buffer): string {
  if (buf.length < IV_LENGTH + TAG_LENGTH) {
    throw new Error('encrypted_secret too short to contain IV + tag');
  }
  const key = loadKey();
  const iv = buf.subarray(0, IV_LENGTH);
  const tag = buf.subarray(buf.length - TAG_LENGTH);
  const ct = buf.subarray(IV_LENGTH, buf.length - TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString('utf8');
}
