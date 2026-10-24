import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const CATEGORIZATION_WORKER_PATH = '/api/categorization/jobs/worker';
export const WORKER_JOB_HEADER = 'x-finadviser-job-id';
export const WORKER_TIMESTAMP_HEADER = 'x-finadviser-worker-timestamp';
export const WORKER_SIGNATURE_HEADER = 'x-finadviser-worker-signature';
const TOKEN_MAX_AGE_MS = 120_000;
const FUTURE_SKEW_MS = 15_000;
const jobIdSchema = z.uuid();

function signature(secret: string, jobId: string, timestamp: string): string {
  return createHmac('sha256', secret)
    .update(`finadviser.categorization-worker.v1\nPOST\n${CATEGORIZATION_WORKER_PATH}\n${timestamp}\n${jobId}`)
    .digest('hex');
}

/** These headers stay between server functions; they are never returned to a browser. */
export function createCategorizationWorkerHeaders(jobId: string, secret: string, now = Date.now()): Record<string, string> {
  if (!jobIdSchema.safeParse(jobId).success || !secret || !Number.isSafeInteger(now) || now < 0) {
    throw new Error('Categorisation worker signing is unavailable.');
  }
  const timestamp = String(now);
  return {
    [WORKER_JOB_HEADER]: jobId,
    [WORKER_TIMESTAMP_HEADER]: timestamp,
    [WORKER_SIGNATURE_HEADER]: signature(secret, jobId, timestamp),
  };
}

/** Short-lived, method/path/job-bound capabilities; duplicate delivery is handled by the durable job lease. */
export function authenticatedCategorizationJobId(request: Request, secret: string | undefined, now = Date.now()): string | null {
  if (!secret || request.method !== 'POST' || !Number.isSafeInteger(now)) return null;
  const url = new URL(request.url);
  if (url.pathname !== CATEGORIZATION_WORKER_PATH || url.search) return null;
  const jobId = request.headers.get(WORKER_JOB_HEADER);
  const timestamp = request.headers.get(WORKER_TIMESTAMP_HEADER);
  const supplied = request.headers.get(WORKER_SIGNATURE_HEADER);
  if (!jobId || !jobIdSchema.safeParse(jobId).success || !timestamp || !/^\d{13}$/.test(timestamp)
    || !supplied || !/^[a-f0-9]{64}$/.test(supplied)) return null;
  const issuedAt = Number(timestamp);
  if (!Number.isSafeInteger(issuedAt) || now - issuedAt > TOKEN_MAX_AGE_MS || issuedAt - now > FUTURE_SKEW_MS) return null;
  const expected = signature(secret, jobId, timestamp);
  return timingSafeEqual(Buffer.from(supplied, 'hex'), Buffer.from(expected, 'hex')) ? jobId : null;
}
