import { categorizationJobSchema } from '@/lib/categorization/jobs/schema';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';
import { isCategorizationContinuationRequest } from './specialists/routing';

type CommandContext = {
  message: string;
  history: { role: string; content: string }[];
  execute: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  onToolStart?: (name: string) => void;
  signal: AbortSignal;
};

function parseResult(value: unknown): { job: CategorizationJob; scheduled: boolean; backgroundAvailable: boolean } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  const parsed = categorizationJobSchema.safeParse(result.job);
  if (!parsed.success || typeof result.scheduled !== 'boolean' || typeof result.backgroundAvailable !== 'boolean') return null;
  return { job: parsed.data, scheduled: result.scheduled, backgroundAvailable: result.backgroundAvailable };
}

/** Only registered, explicit global queue commands use this path; no financial analysis is generated. */
export async function executeCategorizationCommand(context: CommandContext): Promise<string> {
  const invoke = async (name: string, input: Record<string, unknown>) => {
    context.signal.throwIfAborted();
    context.onToolStart?.(name);
    return context.execute(name, input);
  };
  let result: ReturnType<typeof parseResult>;
  try {
    result = parseResult(await invoke('start_categorization_job', {}));
    if (result?.job.status === 'paused' && isCategorizationContinuationRequest(context.message, context.history)) {
      result = parseResult(await invoke('control_categorization_job', { job_id: result.job.id, action: 'resume' }));
    }
  } catch {
    context.signal.throwIfAborted();
    return 'I could not confirm the processing job’s current state. Check the [Data assistant](/data) before starting another job; any decisions already saved remain in your records.';
  }
  context.signal.throwIfAborted();
  if (!result) return 'I could not confirm the processing job’s current state. Check the [Data assistant](/data) before starting another job; any decisions already saved remain in your records.';
  const { job } = result;
  const applied = job.totals.ruleBased + job.totals.aiCategorized + job.totals.learned;
  const progress = `${job.countsExact ? '' : 'At least '}${applied.toLocaleString('en-GB')} categorised and ${job.totals.reviewQueued.toLocaleString('en-GB')} queued for review in this job’s acknowledged passes.`;
  const observed = job.counts && job.countsObservedAt
    ? ` Last observed: ${job.counts.available.toLocaleString('en-GB')} eligible for automatic processing and ${job.counts.needsReview.toLocaleString('en-GB')} awaiting review.` : ' Current backlog counts are unavailable.';
  const status = job.status === 'completed'
    ? 'Automatic processing for this job’s captured backlog is complete. Review questions may still need your input.'
    : job.status === 'paused'
      ? 'The processing job is paused. Open the Data assistant to inspect the reason and resume when ready.'
      : job.status === 'cancelled'
        ? 'The processing job is cancelled. Any completed decisions remain saved.'
        : job.status === 'running'
          ? 'Your processing job is running independently of this chat.'
          : result.backgroundAvailable && result.scheduled
            ? 'Your processing job is saved and queued for a background worker. You do not need to ask for each batch.'
            : 'Your processing job is saved and queued, but background continuation could not be scheduled here. Open the Data assistant to check the worker status.';
  return `${status}\n\n${progress}${observed}\n\n[Track progress or stop processing in the Data assistant](/data).`;
}
