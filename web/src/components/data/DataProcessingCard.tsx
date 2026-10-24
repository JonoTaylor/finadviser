'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, Card, CardContent, Chip, LinearProgress, Skeleton, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import { fetchJson } from '@/lib/http/client';
import type { DataIntelligenceReport } from '@/lib/data-intelligence/types';
import DashboardCardHeader from '@/components/dashboard/DashboardCardHeader';
import ProcessingSummary from './ProcessingSummary';
import useDataProcessing from './useDataProcessing';

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
    if (attempted.current || !visible || !data || data.transactions.unprocessedCount == null || data.transactions.unprocessedCount === 0 || document.visibilityState === 'hidden') return;
    attempted.current = true;
    void run(true, data.processing.modelAvailable ? 5 : 1);
  }, [data, run, visible]);
  const gaps = data?.gaps.filter(gap => gap.status !== 'unavailable') ?? [];
  const urgent = gaps.filter(gap => gap.priority === 'high').length;
  return <Card><CardContent>
    <DashboardCardHeader title="Your data assistant" subtitle="AI organises supported matches and brings the questions that need you into one place."
      action={<Button component={Link} href="/data" variant="outlined" size="small" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}>Open assistant</Button>} />
    {isLoading && <Skeleton variant="rounded" height={56} />}
    {error && <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Data readiness could not be loaded. Your records have not been treated as complete.</Alert>}
    {data && <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'center' }}>
      <Box sx={{ display: 'flex', gap: 1.25, alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
        <Box sx={{ width: 34, height: 34, display: 'grid', placeItems: 'center', bgcolor: '#F0FDFA', color: 'primary.main', borderRadius: '7px', flexShrink: 0 }}><AutoFixHighRoundedIcon sx={{ fontSize: 20 }} /></Box>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{processing.running ? 'Organising your transactions…' : data.transactions.status === 'unavailable' ? 'Transaction coverage unavailable' : data.transactions.unprocessedCount == null ? 'Processing backlog unavailable' : data.transactions.unprocessedCount > 0 ? `${data.transactions.unprocessedCount} records queued for processing` : 'No records queued for automatic processing'}</Typography>
          <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{data.processing.modelAvailable ? 'Strong matches are categorised automatically. Ambiguous records stay in your review queue.' : 'AI processing is unavailable. Saved rules can still match records; the assistant shows the information you need to add.'}</Typography>
        </Box>
      </Box>
      <Stack direction="row" gap={1} flexWrap="wrap">
        <Chip component={Link} href="/data#review" clickable size="small" variant="outlined" label={`${data.transactions.reviewNeededCount ?? '—'} to review`} />
        <Chip component={Link} href="/data#missing-information" clickable size="small" variant="outlined" color={urgent ? 'warning' : 'default'} label={`${gaps.length} information gap${gaps.length === 1 ? '' : 's'}`} />
      </Stack>
    </Stack>}
    {processing.running && <Box sx={{ mt: 2 }}>
      <LinearProgress aria-label="Processing transactions" sx={{ mb: 1, borderRadius: '4px' }} />
      <Stack direction="row" gap={1} justifyContent="space-between" flexWrap="wrap" alignItems="center" aria-live="polite"><Typography variant="caption">{processing.cancelRequested ? 'Stopping after the current pass…' : processing.passes ? `${processing.passes} pass${processing.passes === 1 ? '' : 'es'} complete. Organising the next records…` : 'Organising the first batch…'}</Typography><Button size="small" onClick={processing.cancel} disabled={processing.cancelRequested}>Stop after this pass</Button></Stack>
    </Box>}
    {processing.result && <Box sx={{ mt: 2 }}><ProcessingSummary result={processing.result} onContinue={() => void run(true, 5)} running={processing.running} /></Box>}
    {processing.error && <Alert severity="warning" sx={{ mt: 2 }}>{processing.error}<Button component={Link} href="/data" size="small" sx={{ display: 'block', mt: 0.5 }}>Open assistant to retry</Button></Alert>}
    {processing.notice && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>{processing.notice}</Typography>}
  </CardContent></Card>;
}
