'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import useSWR, { useSWRConfig } from 'swr';
import { fetchJson } from '@/lib/http/client';
import { categorizationJobsResponseSchema } from '@/lib/categorization/jobs/response';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

const JOBS_URL = '/api/categorization/jobs';
type JobResponse = { job: CategorizationJob | null; backgroundAvailable: boolean; issue: string | null };
type JobAction = 'start' | 'pause' | 'resume' | 'cancel';

/** Revalidate derived financial views after actual categorisation or review. */
export function isFinancialDataKey(key: unknown): boolean {
  return typeof key === 'string' && ['/api/data-intelligence', '/api/journal', '/api/plan', '/api/reviews', '/api/finance', '/api/spending', '/api/budgets', '/api/dashboard', '/api/tips', '/api/accounts', '/api/investments', '/api/debts', '/api/portfolio', '/api/pension-records', '/api/property-operations', '/api/properties'].some(prefix => key.startsWith(prefix));
}

export function canAutomaticallyStartCategorization(job: CategorizationJob | null, available: number | null | undefined): boolean {
  return available !== null && available !== undefined && available > 0 && (job === null || job.status === 'completed');
}

async function requestJob(url: string, init?: RequestInit): Promise<JobResponse> {
  const parsed = categorizationJobsResponseSchema.safeParse(await fetchJson<unknown>(url, init));
  if (!parsed.success) throw new Error('The server returned an unreadable processing status. Reload the status before starting another run.');
  return parsed.data;
}

/** The browser observes a durable server job; navigation never cancels its work. */
export default function useDataProcessing() {
  const { mutate } = useSWRConfig();
  const { data, error: statusError, isLoading, mutate: mutateJob } = useSWR(JOBS_URL, requestJob, {
    shouldRetryOnError: false, refreshInterval: 5_000, refreshWhenHidden: false,
  });
  const [pendingAction, setPendingAction] = useState<JobAction | null>(null);
  const [actionError, setActionError] = useState('');
  const activeAction = useRef(false);
  const mounted = useRef(true);
  const observedRevision = useRef<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refreshFinancial = useCallback(async () => { await mutate(isFinancialDataKey); }, [mutate]);
  const refresh = useCallback(async () => { await Promise.all([refreshFinancial(), mutateJob()]); }, [refreshFinancial, mutateJob]);
  const job = data?.job ?? null;

  useEffect(() => {
    if (!job) return;
    const revision = `${job.id}:${job.updatedAt}`;
    if (revision === observedRevision.current) return;
    observedRevision.current = revision;
    if (job.passes > 0 || ['completed', 'paused', 'cancelled'].includes(job.status)) void refreshFinancial().catch(() => undefined);
  }, [job, refreshFinancial]);

  const control = useCallback(async (action: JobAction) => {
    if (activeAction.current) return;
    activeAction.current = true;
    setPendingAction(action);
    setActionError('');
    try {
      if (action !== 'start' && !job) return;
      const response = await requestJob(action === 'start' ? JOBS_URL : `${JOBS_URL}/${job!.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action === 'start' ? {} : { action }),
      });
      await mutateJob(response, { revalidate: false });
      // A failed derived-view refresh does not make an acknowledged job
      // command uncertain. Its authoritative status is already in the cache.
      void refreshFinancial().catch(() => undefined);
    } catch (cause) {
      if (mounted.current) setActionError('The processing request could not be confirmed. ' + (cause instanceof Error ? cause.message : 'Reload the current status before trying again.'));
      // A lost response may follow an accepted action. Observe, never replay it.
      await mutateJob().catch(() => undefined);
    } finally {
      activeAction.current = false;
      if (mounted.current) setPendingAction(null);
    }
  }, [job, mutateJob, refreshFinancial]);
  const run = useCallback(async () => {
    if (job?.status === 'queued' || job?.status === 'running') return;
    await control(job?.status === 'paused' ? 'resume' : 'start');
  }, [job, control]);
  const pause = useCallback(() => control('pause'), [control]);
  const cancel = useCallback(() => control('cancel'), [control]);

  return {
    job, run, pause, cancel, refresh, pendingAction,
    running: pendingAction === 'start' || pendingAction === 'resume' || job?.status === 'queued' || job?.status === 'running',
    jobLoading: isLoading, jobLoaded: data !== undefined,
    backgroundAvailable: data?.backgroundAvailable ?? false, issue: data?.issue ?? null,
    error: actionError || (statusError instanceof Error ? statusError.message : statusError ? 'Processing status could not be loaded.' : ''),
  };
}
