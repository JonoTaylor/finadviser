'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, Card, CardContent, Chip, Skeleton, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import { fetchJson } from '@/lib/http/client';
import type { DataIntelligenceReport } from '@/lib/data-intelligence/types';
import DashboardCardHeader from '@/components/dashboard/DashboardCardHeader';
import CategorizationJobProgress from './CategorizationJobProgress';
import useDataProcessing, { canAutomaticallyStartCategorization } from './useDataProcessing';

export default function DataProcessingCard() {
  const { data, error, isLoading, mutate } = useSWR<DataIntelligenceReport>('/api/data-intelligence', fetchJson, { shouldRetryOnError: false });
  const processing = useDataProcessing();
  const { run } = processing;
  const attempted = useRef(false);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  useEffect(() => {
    const available = processing.job ? processing.job.counts?.available : data?.transactions.unprocessedCount;
    if (attempted.current || !visible || !data || !processing.jobLoaded || processing.error || !canAutomaticallyStartCategorization(processing.job, available) || document.visibilityState === 'hidden') return;
    attempted.current = true;
    void run();
  }, [data, run, visible, processing.jobLoaded, processing.job, processing.error]);
  const gaps = data?.gaps.filter(gap => gap.status !== 'unavailable') ?? [];
  const urgent = gaps.filter(gap => gap.priority === 'high').length;
  return <Card><CardContent>
    <DashboardCardHeader title="Your data assistant" subtitle="AI organises ordinary spending and brings unresolved context into one place."
      action={<Button component={Link} href="/data" variant="outlined" size="small" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}>Open assistant</Button>} />
    {isLoading && <Skeleton variant="rounded" height={56} />}
    {error && <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Data readiness could not be loaded. Your records have not been treated as complete.</Alert>}
    {data && <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'center' }}>
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', bgcolor: '#F0FDFA', color: 'primary.main', borderRadius: '7px', flexShrink: 0 }}><AutoFixHighRoundedIcon sx={{ fontSize: 20 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{processing.job?.status === 'queued' ? 'Transaction processing is queued' : processing.running ? 'Organising your transactions…' : data.transactions.status === 'unavailable' ? 'Transaction coverage unavailable' : data.transactions.unprocessedCount == null ? 'Processing backlog unavailable' : data.transactions.unprocessedCount > 0 ? `${data.transactions.unprocessedCount} records queued for processing` : 'No records queued for automatic processing'}</Typography>
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{data.processing.modelAvailable ? 'Spending is organised automatically. Estimates and unknown details stay visible; you can refine them later.' : 'AI processing is unavailable. Saved rules can still match records; the assistant shows the information you need to add.'}</Typography>
        </Box>
      </Box>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Chip component={Link} href="/data#review" clickable size="small" variant="outlined" label={`${data.transactions.reviewNeededCount ?? '—'} to review`} />
        <Chip component={Link} href="/data#missing-information" clickable size="small" variant="outlined" color={urgent ? 'warning' : 'default'} label={`${gaps.length} information gap${gaps.length === 1 ? '' : 's'}`} />
      </Stack>
    </Stack>}
    {processing.job && <Box sx={{ mt: 2 }}><CategorizationJobProgress job={processing.job} issue={processing.issue} backgroundAvailable={processing.backgroundAvailable} pending={processing.pendingAction !== null} compact onPause={() => void processing.pause()} onResume={() => void run()} /></Box>}
    {processing.error && <Alert severity="warning" sx={{ mt: 2 }}>{processing.error}<Button size="small" onClick={() => void processing.refresh()} sx={{ display: 'block', mt: 0.5 }}>Reload processing status</Button></Alert>}
  </CardContent></Card>;
}
