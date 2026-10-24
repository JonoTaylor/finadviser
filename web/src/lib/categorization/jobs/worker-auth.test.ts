import { describe, expect, it } from 'vitest';
import {
  authenticatedCategorizationJobId, createCategorizationWorkerHeaders, CATEGORIZATION_WORKER_PATH,
  WORKER_JOB_HEADER, WORKER_SIGNATURE_HEADER, WORKER_TIMESTAMP_HEADER,
} from './worker-auth';

const jobId = 'd821a308-79c7-4d59-8bf1-f7c895d231a4';
const otherJob = '65a0453a-a351-48b7-b6d7-6f1949ca74b1';
const secret = 'synthetic-worker-only-secret-123456';
const now = Date.parse('2026-10-24T18:00:00Z');
function request(headers: Record<string, string>, path = CATEGORIZATION_WORKER_PATH, method = 'POST') {
  return new Request(`https://fixture.vercel.app${path}`, { method, headers });
}

describe('internal categorisation worker capability', () => {
  it('authenticates the exact job, method and path using a short-lived server-only capability', () => {
    const headers = createCategorizationWorkerHeaders(jobId, secret, now);
    expect(authenticatedCategorizationJobId(request(headers), secret, now + 1000)).toBe(jobId);
    expect(JSON.stringify(headers)).not.toContain(secret);
    expect(Object.keys(headers).sort()).toEqual([WORKER_JOB_HEADER, WORKER_SIGNATURE_HEADER, WORKER_TIMESTAMP_HEADER].sort());
  });
  it('rejects job substitution, modified signatures, other methods and cross-route reuse', () => {
    const headers = createCategorizationWorkerHeaders(jobId, secret, now);
    expect(authenticatedCategorizationJobId(request({ ...headers, [WORKER_JOB_HEADER]: otherJob }), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request({ ...headers, [WORKER_SIGNATURE_HEADER]: 'a'.repeat(64) }), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers, CATEGORIZATION_WORKER_PATH, 'GET'), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers, '/api/categorization/jobs'), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers, CATEGORIZATION_WORKER_PATH + '?jobId=' + otherJob), secret, now)).toBeNull();
  });
  it('fails closed for missing, expired, future or malformed credentials', () => {
    const headers = createCategorizationWorkerHeaders(jobId, secret, now);
    expect(authenticatedCategorizationJobId(request(headers), undefined, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers), secret + 'rotated', now)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers), secret, now + 120_001)).toBeNull();
    expect(authenticatedCategorizationJobId(request(headers), secret, now - 15_001)).toBeNull();
    expect(authenticatedCategorizationJobId(request({}), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request({ ...headers, [WORKER_SIGNATURE_HEADER]: 'short' }), secret, now)).toBeNull();
    expect(authenticatedCategorizationJobId(request({ ...headers, [WORKER_TIMESTAMP_HEADER]: 'Infinity' }), secret, now)).toBeNull();
  });
});
