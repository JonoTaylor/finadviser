'use client';

import Link from 'next/link';
import { Alert, Box, Button, Chip, LinearProgress, Stack, Typography } from '@mui/material';
import type { CategorizationJob } from '@/lib/categorization/jobs/types';

type Props = {
  job: CategorizationJob; issue?: string | null; backgroundAvailable?: boolean;
  pending?: boolean; compact?: boolean;
  onPause?: () => void; onResume?: () => void; onCancel?: () => void;
};
const statusLabels = { queued: 'Queued to continue', running: 'Organising transactions', paused: 'Processing paused', completed: 'Automatic run finished', cancelled: 'Processing stopped' };

export default function CategorizationJobProgress({ job, issue = null, backgroundAvailable = false, pending = false, compact = false, onPause, onResume, onCancel }: Props) {
  const active = job.status === 'queued' || job.status === 'running';
  const stopping = active && (job.pauseRequested || job.cancelRequested);
  const applied = job.totals.ruleBased + job.totals.aiCategorized + job.totals.learned;
  const heading = active && job.cancelRequested ? 'Stopping after the current pass…' : active && job.pauseRequested ? 'Pausing after the current pass…' : statusLabels[job.status];
  const countLabel = (value: number, label: string) => job.countsExact ? `${value} ${label}` : value > 0 ? `At least ${value} ${label}` : `${label.charAt(0).toUpperCase() + label.slice(1)} total unconfirmed`;
  const observedAt = job.countsObservedAt ? new Date(job.countsObservedAt) : null;
  const observed = observedAt && !Number.isNaN(observedAt.getTime()) ? observedAt.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : null;
  return <Box aria-live="polite" sx={{ minWidth: 0 }}>
    <Stack direction="row" gap={1} alignItems="center" justifyContent="space-between" flexWrap="wrap">
      <Typography component="h3" variant="body2" sx={{ fontWeight: 600 }}>{heading}</Typography>
      <Stack direction="row" gap={0.5} flexWrap="wrap">
        {active && onPause && <Button size="small" onClick={onPause} disabled={pending || stopping}>Pause after this pass</Button>}
        {job.status === 'paused' && onResume && <Button size="small" variant="outlined" onClick={onResume} disabled={pending}>Resume processing</Button>}
        {job.status === 'paused' && onCancel && <Button size="small" onClick={onCancel} disabled={pending}>End this run</Button>}
        {compact && <Button component={Link} href="/data" size="small">View progress</Button>}
      </Stack>
    </Stack>
    {active && <LinearProgress aria-label={job.status === 'queued' ? 'Waiting for the next processing pass' : 'Processing transactions'} sx={{ mt: 1, mb: 1.25 }} />}
    <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: active ? 0 : 1 }}>
      <Chip size="small" variant="outlined" label={countLabel(applied, 'categorised')} color={applied ? 'success' : 'default'} />
      <Chip size="small" variant="outlined" label={countLabel(job.totals.reviewQueued, 'sent for review')} />
      <Chip size="small" variant="outlined" label={`${job.passes} confirmed pass${job.passes === 1 ? '' : 'es'}`} />
    </Stack>
    {job.counts && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
      {job.counts.available} eligible for automatic processing · <Link href="/data#review">{job.counts.needsReview} need review</Link>
      {observed && <Typography component="span" variant="caption"> · Checked {observed} UK time</Typography>}
    </Typography>}
    {!job.counts && <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Waiting for the first backlog check. Remaining records have not been counted yet.</Typography>}
    {active && !issue && backgroundAvailable && <Typography variant="caption" component="p" sx={{ mt: 1 }}>{job.status === 'running' ? 'This pass runs on the server. You can leave this page and return to the saved progress.' : 'This run is queued on the server. Return here to check its saved progress.'}</Typography>}
    {active && !issue && !backgroundAvailable && <Typography variant="caption" component="p" sx={{ mt: 1 }}>Background continuation is unavailable. This run remains saved; check its status before starting another run.</Typography>}
    {job.status === 'completed' && <Typography variant="caption" component="p" sx={{ mt: 1 }}>This automatic run has finished. Review questions and missing financial information may still need your attention.</Typography>}
    {job.status === 'cancelled' && <Typography variant="caption" component="p" sx={{ mt: 1 }}>Completed category decisions remain saved. This run will not start another pass.</Typography>}
    {!job.countsExact && <Alert severity="warning" sx={{ mt: 1 }}>An interrupted pass could not be fully reconciled with this run’s totals. Confirmed progress is shown; check the current records before relying on a complete total.</Alert>}
    {issue && <Alert severity="warning" sx={{ mt: 1 }}>{issue}</Alert>}
    {job.status === 'paused' && job.message && <Alert severity="info" sx={{ mt: 1 }}>{job.message}</Alert>}
    {job.totals.conflicts > 0 && <Typography variant="caption" component="p" sx={{ mt: 1 }}>{job.totals.conflicts} conflicting decisions were not applied; newer transaction details were kept.</Typography>}
  </Box>;
}
