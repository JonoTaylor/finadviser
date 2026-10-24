import { dispatchCategorizationJob, shouldWakeCategorizationJob } from './dispatch';
import { getCategorizationJob } from './service';

/** Resume a previously authorised active job; never create or unpause one from a recovery sweep. */
export async function recoverCategorizationJob(): Promise<void> {
  try {
    const job = await getCategorizationJob();
    if (job && shouldWakeCategorizationJob(job)) await dispatchCategorizationJob(job.id);
  } catch {
    console.warn('[categorization-jobs] recovery status unavailable');
  }
}
