import { buildMerchantResearchQuery } from './privacy';
import { lookupMerchant } from './provider';
import { merchantResearchRepo } from './repository';
import { merchantResearchResultSchema } from './schema';
import type { MerchantResearchInput, MerchantResearchResult } from './types';

export type MerchantResearchOptions = { signal?: AbortSignal; timeoutMs?: number };

function emptyResult(status: MerchantResearchResult['status'], query: string | null): MerchantResearchResult {
  return { status, query, sources: [], researchedAt: new Date().toISOString(), provider: 'gateway_perplexity', scope: 'merchant_identity_only' };
}

function bounded<T>(operation: Promise<T>, timeoutMs: number, signal: AbortSignal): Promise<T | null> {
  return new Promise(resolve => {
    let settled = false;
    const finish = (value: T | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      resolve(value);
    };
    const onAbort = () => finish(null);
    const timer = setTimeout(() => finish(null), Math.max(0, timeoutMs));
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) finish(null);
    operation.then(finish, () => finish(null));
  });
}

/** The entire lookup, cache included, shares the caller's finite budget. */
export async function researchMerchant(input: MerchantResearchInput, options: MerchantResearchOptions = {}): Promise<MerchantResearchResult> {
  const query = buildMerchantResearchQuery(input);
  if (!query) return emptyResult('skipped_private', null);
  const timeout = Number.isFinite(options.timeoutMs) ? Math.max(0, Math.min(6000, options.timeoutMs!)) : 6000;
  if (timeout === 0 || options.signal?.aborted) return emptyResult('timed_out', query.query);
  const deadline = Date.now() + timeout;
  const controller = new AbortController();
  const abort = () => controller.abort();
  const timer = setTimeout(abort, timeout);
  options.signal?.addEventListener('abort', abort, { once: true });
  const remaining = () => Math.max(0, deadline - Date.now());
  try {
    const cached = await bounded(merchantResearchRepo.find(query), Math.min(350, remaining()), controller.signal);
    if (cached) return cached;
    if (controller.signal.aborted || remaining() === 0) return emptyResult('timed_out', query.query);
    const result = await bounded(lookupMerchant(input, { signal: controller.signal, timeoutMs: remaining() }), remaining(), controller.signal);
    if (!result) return emptyResult(controller.signal.aborted || remaining() === 0 ? 'timed_out' : 'unavailable', query.query);
    const parsed = merchantResearchResultSchema.safeParse(result);
    if (!parsed.success || parsed.data.query !== query.query) return emptyResult('unavailable', query.query);
    if (['matched', 'no_matches'].includes(parsed.data.status) && remaining() > 0 && !controller.signal.aborted) {
      await bounded(merchantResearchRepo.save(query, parsed.data), Math.min(350, remaining()), controller.signal);
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
