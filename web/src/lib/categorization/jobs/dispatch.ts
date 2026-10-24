import { after } from 'next/server';
import { createCategorizationWorkerHeaders, CATEGORIZATION_WORKER_PATH } from './worker-auth';
import { recordCategorizationDispatch } from './service';
import type { CategorizationJob } from './types';

type WorkerEnvironment = Record<string, string | undefined>;
export type DispatchResult = { accepted: boolean; reason: 'not_configured' | 'network_unavailable' | 'rejected' | null };
const DISPATCH_MS = 5_000;
const WAKE_AFTER_MS = 10_000;
const FAILED_HANDOFF_BACKOFF_MS = 30_000;

function deploymentOrigin(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
      || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.vercel\.app$/i.test(url.hostname)) return null;
    return url.origin;
  } catch { return null; }
}

/** Only platform-configured deployment hosts, never Host/Origin headers or transaction data. */
export function categorizationWorkerOrigin(environment: WorkerEnvironment = process.env): string | null {
  const deployed = deploymentOrigin(environment.VERCEL_URL);
  const production = deploymentOrigin(environment.VERCEL_PROJECT_PRODUCTION_URL);
  return environment.VERCEL_ENV === 'production' ? production ?? deployed : deployed ?? production;
}

export function getCategorizationBackgroundCapability(environment: WorkerEnvironment = process.env): { backgroundAvailable: boolean; issue: string | null } {
  if (!environment.SESSION_SECRET || !categorizationWorkerOrigin(environment)) return {
    backgroundAvailable: false,
    issue: 'Automatic continuation is not configured on this deployment. The saved job can resume when worker access is available.',
  };
  return { backgroundAvailable: true, issue: null };
}

export function shouldWakeCategorizationJob(job: CategorizationJob | null, now = Date.now()): boolean {
  if (!job) return false;
  // An expired worker must acknowledge a pending stop/pause too. The core
  // finalises that control state without starting another processing pass.
  if (job.status === 'running') {
    const expired = job.leaseExpiresAt !== null && Date.parse(job.leaseExpiresAt) <= now;
    return expired && (!job.dispatchIssue || now - Date.parse(job.updatedAt) >= FAILED_HANDOFF_BACKOFF_MS);
  }
  if (job.cancelRequested || job.pauseRequested) return false;
  if (job.status === 'queued') {
    const waitMs = job.dispatchIssue ? FAILED_HANDOFF_BACKOFF_MS : WAKE_AFTER_MS;
    return now - Date.parse(job.updatedAt) >= waitMs;
  }
  return false;
}

async function noteDispatch(jobId: string, result: DispatchResult): Promise<void> {
  const issue = result.reason === 'not_configured' ? 'Automatic continuation is not configured on this deployment.'
    : result.reason === 'rejected' ? 'The background worker did not accept its handoff. The job remains saved and will be checked again.'
      : result.reason === 'network_unavailable' ? 'The next background worker could not be reached. The job remains saved and will be checked again.' : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      recordCategorizationDispatch(jobId, result.accepted, issue),
      new Promise<void>(resolve => { timer = setTimeout(resolve, 1_000); }),
    ]);
  } catch {
    console.warn('[categorization-jobs] dispatch acknowledgement unavailable');
  } finally { clearTimeout(timer); }
}

/** A 202 acknowledges only a handoff, never completed financial processing. */
export async function dispatchCategorizationJob(jobId: string): Promise<DispatchResult> {
  const origin = categorizationWorkerOrigin();
  const secret = process.env.SESSION_SECRET;
  if (!origin || !secret) {
    const result: DispatchResult = { accepted: false, reason: 'not_configured' };
    await noteDispatch(jobId, result);
    return result;
  }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let result: DispatchResult;
  try {
    const response = await Promise.race([
      fetch(new URL(CATEGORIZATION_WORKER_PATH, origin), {
        method: 'POST', headers: createCategorizationWorkerHeaders(jobId, secret),
        redirect: 'error', cache: 'no-store', signal: controller.signal,
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => {
        controller.abort(); reject(new Error('Worker handoff exceeded its budget.'));
      }, DISPATCH_MS); }),
    ]);
    result = response.status === 202 ? { accepted: true, reason: null } : { accepted: false, reason: 'rejected' };
    // Do not read or log response bodies: a deployment proxy may return HTML or private diagnostics.
  } catch { result = { accepted: false, reason: 'network_unavailable' }; }
  finally { clearTimeout(timer); controller.abort(); }
  await noteDispatch(jobId, result);
  return result;
}

/** Register with Next's request lifetime; no unawaited network promise is discarded at response end. */
export function scheduleCategorizationJob(jobId: string): { scheduled: boolean; reason: 'not_configured' | 'context_unavailable' | null } {
  if (!getCategorizationBackgroundCapability().backgroundAvailable) return { scheduled: false, reason: 'not_configured' };
  try {
    after(async () => { await dispatchCategorizationJob(jobId); });
    return { scheduled: true, reason: null };
  } catch {
    return { scheduled: false, reason: 'context_unavailable' };
  }
}
