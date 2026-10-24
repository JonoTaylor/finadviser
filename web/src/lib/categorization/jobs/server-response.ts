import { getCategorizationBackgroundCapability, scheduleCategorizationJob, shouldWakeCategorizationJob } from './dispatch';
import { categorizationJobsResponseSchema, type CategorizationJobsResponse } from './response';
import type { CategorizationJob } from './types';

export function categorizationJobResponse(job: CategorizationJob | null, wakeNow = false): CategorizationJobsResponse {
  const capability = getCategorizationBackgroundCapability();
  const active = job?.status === 'queued' || job?.status === 'running';
  const issue = active ? job.dispatchIssue ?? capability.issue : job === null ? capability.issue : null;
  // Validate before registering a background action. An unreadable DTO must
  // not silently schedule financial work behind an error response.
  const response = categorizationJobsResponseSchema.parse({ job, backgroundAvailable: capability.backgroundAvailable, issue });
  if (job && capability.backgroundAvailable
    && ((wakeNow && job.status === 'queued' && !job.cancelRequested && !job.pauseRequested) || shouldWakeCategorizationJob(job))) {
    const scheduled = scheduleCategorizationJob(job.id);
    if (!scheduled.scheduled && scheduled.reason === 'context_unavailable') {
      response.issue = 'The saved job could not schedule its background handoff in this request. Its next status check can try again.';
    }
  }
  return response;
}
