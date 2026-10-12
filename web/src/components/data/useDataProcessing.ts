'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { fetchJson } from '@/lib/http/client';
import type { CategorizationResult } from '@/lib/categorization/types';

/** Revalidate derived financial views after actual categorisation or review. */
export function isFinancialDataKey(key: unknown): boolean {
  return typeof key === 'string' && ['/api/data-intelligence', '/api/journal', '/api/plan', '/api/reviews', '/api/finance', '/api/spending', '/api/budgets', '/api/dashboard', '/api/tips', '/api/accounts', '/api/investments', '/api/debts', '/api/portfolio', '/api/pension-records', '/api/property-operations', '/api/properties'].some(prefix => key.startsWith(prefix));
}

export default function useDataProcessing() {
  const { mutate } = useSWRConfig();
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<CategorizationResult | null>(null);
  const [error, setError] = useState('');
  const [passes, setPasses] = useState(0);
  const [cancelRequested, setCancelRequested] = useState(false);
  const [notice, setNotice] = useState('');
  const active = useRef(false);
  const cancelled = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelled.current = true; }; }, []);
  const refresh = useCallback(async () => { await mutate(isFinancialDataKey); }, [mutate]);

  const run = useCallback(async (all = false, maxPasses = 100) => {
    if (active.current) return;
    active.current = true;
    cancelled.current = false;
    setRunning(true);
    setCancelRequested(false);
    setPasses(0);
    setError('');
    setResult(null);
    setNotice('');
    const passLimit = Number.isInteger(maxPasses) ? Math.max(1, Math.min(maxPasses, 100)) : 100;
    let combined: CategorizationResult | null = null;
    let pass = 0;
    try {
      do {
        const next = await fetchJson<CategorizationResult>('/api/journal/auto-categorize', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ limit: 100 }),
        });
        combined = combined ? {
          ...next,
          total: combined.total + next.total,
          ruleBased: combined.ruleBased + next.ruleBased,
          aiCategorized: combined.aiCategorized + next.aiCategorized,
          learned: combined.learned + next.learned,
          aiNoMatch: combined.aiNoMatch + next.aiNoMatch,
          reviewQueued: combined.reviewQueued + next.reviewQueued,
          conflicts: combined.conflicts + next.conflicts,
          batches: combined.batches + next.batches,
        } : next;
        pass++;
        if (mounted.current) { setResult(combined); setPasses(pass); }
        await refresh();
        // A time-budget pause can safely continue in a fresh bounded pass.
        // Provider failures and unchanged queues must not trigger retries.
        const progressed = next.ruleBased + next.aiCategorized + next.learned + next.reviewQueued;
        const deferredReason = next.deferredReason;
        if (!all || cancelled.current || !mounted.current || next.busy || next.status === 'unavailable' || (next.aiSkippedReason && deferredReason !== 'time_budget') || !next.hasMore || progressed === 0) break;
        if (document.visibilityState === 'hidden') {
          if (mounted.current) setNotice('Processing paused while this tab was inactive. You can continue with the remaining records.');
          break;
        }
        if (pass >= passLimit) {
          if (mounted.current) setNotice('More records remain queued. You can continue processing when you are ready.');
          break;
        }
      } while (mounted.current);
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'Data processing could not finish. Please try again.');
      await refresh().catch(() => undefined);
    } finally {
      active.current = false;
      if (mounted.current) setRunning(false);
    }
  }, [refresh]);

  const cancel = useCallback(() => { cancelled.current = true; setCancelRequested(true); }, []);
  return { run, cancel, refresh, running, result, error, passes, cancelRequested, notice };
}
