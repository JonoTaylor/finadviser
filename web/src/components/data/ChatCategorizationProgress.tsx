'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import useDataProcessing from './useDataProcessing';

export default function ChatCategorizationProgress() {
  const processing = useDataProcessing();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = setTimeout(update, 0);
    const timer = setInterval(update, 60_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, []);
  const job = processing.job;
  if (!job) return null;
  const active = job.status === 'queued' || job.status === 'running';
  const finishedAt = job.finishedAt ? new Date(job.finishedAt).getTime() : 0;
  if (!active && job.status !== 'paused' && (!finishedAt || now === null || now - finishedAt > 30 * 60_000)) return null;
  const applied = job.totals.ruleBased + job.totals.aiCategorized + job.totals.learned;
  const appliedLabel = job.countsExact ? `${applied} categorised in this run` : applied > 0 ? `At least ${applied} categorised in this run` : 'Run total unconfirmed';
  const stopping = active && (job.pauseRequested || job.cancelRequested);
  const status = active && job.cancelRequested ? 'Stopping after this pass' : active && job.pauseRequested ? 'Pausing after this pass'
    : job.status === 'queued' ? 'Processing queued' : job.status === 'running' ? 'Processing transactions'
      : job.status === 'paused' ? 'Processing paused' : job.status === 'cancelled' ? 'Run stopped' : 'Automatic run finished';
  const checked = job.countsObservedAt ? new Date(job.countsObservedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' }) : null;
  const notice = processing.error || processing.issue || (job.status === 'paused' ? job.message : null)
    || (active && !processing.backgroundAvailable ? 'Background continuation is unavailable. Open the saved progress to check this run.' : null);
  return <Box sx={{ p: 1.25, mb: 1.5, border: 1, borderColor: 'divider', borderRadius: '6px', bgcolor: 'background.default', minWidth: 0 }} aria-live="polite">
    <Stack direction="row" gap={0.75} alignItems="center" justifyContent="space-between" flexWrap="wrap">
      <Chip size="small" variant="outlined" color={job.status === 'paused' ? 'warning' : active ? 'primary' : 'default'} label={status} />
      <Stack direction="row" gap={0.25}>
        {active && <Button size="small" disabled={stopping || processing.pendingAction !== null} onClick={() => void processing.pause()}>Pause</Button>}
        {job.status === 'paused' && <Button size="small" disabled={processing.pendingAction !== null} onClick={() => void processing.run()}>Resume</Button>}
        <Button component={Link} href="/data" size="small">View progress</Button>
      </Stack>
    </Stack>
    <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>{appliedLabel}{job.counts ? ` · ${job.counts.needsReview} need review${checked ? ` (checked ${checked} UK time)` : ''}` : ' · Backlog check pending'}</Typography>
    {notice && <Typography variant="caption" color="warning.main" component="p" sx={{ mt: 0.5 }}>{notice}</Typography>}
  </Box>;
}
