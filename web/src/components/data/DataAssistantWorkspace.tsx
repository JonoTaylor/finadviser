'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent, Chip, Grid, Skeleton, Stack, Typography } from '@mui/material';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import CheckCircleOutlineRoundedIcon from '@mui/icons-material/CheckCircleOutlineRounded';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';
import { fetchJson } from '@/lib/http/client';
import type { DataIntelligenceReport } from '@/lib/data-intelligence/types';
import CategorizationJobProgress from './CategorizationJobProgress';
import CategorizationReviewQueue from './CategorizationReviewQueue';
import useDataProcessing from './useDataProcessing';
import PaymentKnowledgeCard from './PaymentKnowledgeCard';

const priorityOrder = { high: 0, medium: 1, low: 2 };
const coverageLabels = { recorded: 'Recorded', empty: 'Not recorded', incomplete: 'Needs detail', stale: 'Needs an update', unavailable: 'Unavailable' };

export default function DataAssistantWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<DataIntelligenceReport>('/api/data-intelligence', fetchJson, { shouldRetryOnError: false });
  const processing = useDataProcessing();
  const queued = processing.job?.counts?.available ?? data?.transactions.unprocessedCount;
  const gaps = data?.gaps.slice().sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]) ?? [];
  return <Box sx={{ minWidth: 0 }}>
    <PageHeader title="Data assistant" description="Let AI organise your records, surface unclear transactions and show exactly what your financial plan is missing." actions={<>
      <Button component={Link} href="/import" variant="outlined" startIcon={<FileUploadOutlinedIcon />}>Add information</Button>
      <Button variant="contained" startIcon={<AutoFixHighRoundedIcon />} disabled={processing.running || processing.pendingAction !== null || !processing.jobLoaded || !data || data.transactions.status === 'unavailable' || queued == null || (queued === 0 && processing.job?.status !== 'paused')} onClick={() => void processing.run()}>{processing.running ? 'Processing…' : processing.job?.status === 'paused' ? 'Resume processing' : 'Reassess and organise'}</Button>
    </>} />

    {error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your data assessment could not be loaded. No coverage or balances have been assumed.</Alert>}
    <Grid container spacing={2} sx={{ mb: 3 }}>
      <Grid size={{ xs: 6, lg: 3 }}><MetricCard label="Transaction records" value={data?.transactions.totalCount ?? '—'} loading={isLoading} detail="Recorded household activity" /></Grid>
      <Grid size={{ xs: 6, lg: 3 }}><MetricCard label="Queued for processing" value={queued ?? '—'} loading={isLoading} detail="Eligible for automatic processing" /></Grid>
      <Grid size={{ xs: 6, lg: 3 }}><MetricCard label="Payments needing context" value={data?.transactions.reviewNeededCount ?? '—'} loading={isLoading} detail="Repeated payments are grouped below" tone="warning" /></Grid>
      <Grid size={{ xs: 6, lg: 3 }}><MetricCard label="Information gaps" value={data ? gaps.filter(gap => gap.status !== 'unavailable').length : '—'} loading={isLoading} detail={data ? `${gaps.filter(gap => gap.status === 'unavailable').length} source${gaps.filter(gap => gap.status === 'unavailable').length === 1 ? '' : 's'} unavailable` : 'Based on your saved records'} tone="accent" /></Grid>
    </Grid>

    <Card sx={{ mb: 3 }}><CardContent>
      <Stack direction={{ xs: 'column', md: 'row' }} gap={2} alignItems={{ md: 'flex-start' }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography component="h2" variant="h6" sx={{ mb: 0.75 }}>Heavy lifting, with the evidence kept visible</Typography>
          <Typography variant="body2" color="text.secondary">Saved rules and reviewed matches organise repeat activity. AI reads each transaction’s actual account context and applies strongly supported categories. Unclear merchants and possible money movements come to you for a quick decision.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Reassessment checks older questions against your saved meanings and recognised services such as Prime membership. Repeated exact payment contexts share one decision below, so you can confirm the displayed payments together and remember the choice for future matches.</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>For eligible unclear merchants, AI can search public business information and keep its sources with the suggestion. Searches use the merchant name and public location details, without transaction amounts or account details.</Typography>
        </Box>
        <Chip size="small" color={data?.processing.modelAvailable ? 'success' : 'default'} variant="outlined" label={isLoading ? 'Checking AI availability…' : data ? data.processing.modelAvailable ? 'AI configured' : 'AI unavailable' : 'Availability unknown'} sx={{ alignSelf: 'flex-start', flexShrink: 0 }} />
      </Stack>
      {data && !data.processing.modelAvailable && <Alert severity="info" sx={{ mt: 2 }}>AI categorisation is unavailable on the server. Processing can still apply saved rules and reviewed matches; the information gaps and review queue remain available.</Alert>}
      {processing.jobLoading && <Skeleton variant="rounded" height={75} sx={{ mt: 2 }} />}
      {processing.job && <Box sx={{ mt: 2 }}><CategorizationJobProgress job={processing.job} issue={processing.issue} backgroundAvailable={processing.backgroundAvailable} pending={processing.pendingAction !== null} onPause={() => void processing.pause()} onResume={() => void processing.run()} onCancel={() => void processing.cancel()} /></Box>}
      {processing.error && <Alert severity="warning" sx={{ mt: 2 }} action={<Button size="small" onClick={() => void processing.refresh()}>Reload status</Button>}>{processing.error}</Alert>}
      {!processing.job && processing.issue && <Alert severity="info" sx={{ mt: 2 }}>{processing.issue}</Alert>}
      {data && <Typography variant="caption" component="p" sx={{ mt: 2 }}>Household data snapshot · {data.asOf} · Missing information stays unknown until you provide or confirm it.</Typography>}
    </CardContent></Card>

    <Box id="payment-meanings" sx={{ scrollMarginTop: 84, mb: 3 }}><PaymentKnowledgeCard onChanged={processing.refresh} /></Box>
    <Box id="review" sx={{ scrollMarginTop: 84, mb: 3 }}><CategorizationReviewQueue onReviewed={processing.refresh} /></Box>

    <Box id="missing-information" sx={{ scrollMarginTop: 84, mb: 3 }}>
      <Stack direction="row" gap={1.5} flexWrap="wrap" justifyContent="space-between" alignItems="center" sx={{ mb: 1.75 }}>
        <Box><Typography variant="h6" component="h2">What your adviser needs next</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Start with the gaps that most affect your spending and wealth decisions.</Typography></Box>
        <Button component={Link} href="/chat" size="small" variant="outlined" endIcon={<ArrowForwardRoundedIcon />}>Help me complete my data</Button>
      </Stack>
      {isLoading && <Skeleton variant="rounded" height={160} />}
      {data && gaps.length === 0 && <Alert severity="success" icon={<CheckCircleOutlineRoundedIcon />}>No gaps were found in the recorded fields. Coverage reflects saved information and does not verify external balances or statements.</Alert>}
      <Stack gap={1.5}>{gaps.map(gap => <Card key={gap.id}><CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} justifyContent="space-between" alignItems={{ sm: 'flex-start' }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 0.75 }}><Typography variant="subtitle2" component="h3">{gap.title}</Typography><Chip size="small" variant="outlined" color={gap.priority === 'high' ? 'warning' : 'default'} label={gap.status === 'unavailable' ? 'Source unavailable' : gap.priority === 'high' ? 'Priority' : gap.priority === 'medium' ? 'Next' : 'Useful detail'} /></Stack>
            <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{gap.reason}</Typography>
            {gap.evidence.map((evidence, index) => <Typography key={index} variant="caption" component="p" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{evidence}</Typography>)}
            <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>Source: {gap.source}{gap.affectedCount !== null ? ` · ${gap.affectedCount} affected record${gap.affectedCount === 1 ? '' : 's'}` : ''}</Typography>
          </Box>
          <Button component={Link} href={gap.action.href} variant="outlined" size="small" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />} sx={{ flexShrink: 0, alignSelf: 'flex-start' }}>{gap.action.label}</Button>
        </Stack>
      </CardContent></Card>)}</Stack>
    </Box>

    {data && <Card><CardContent>
      <Typography component="h2" variant="h6" sx={{ mb: 0.5 }}>Coverage across your finances</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>See which records are present and where the assessment comes from.</Typography>
      {data.coverage.map(item => <Accordion key={item.domain} disableGutters elevation={0} sx={{ border: 1, borderColor: 'divider', borderRadius: '7px', mb: 1, '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Stack direction="row" gap={1.25} justifyContent="space-between" sx={{ width: '100%', pr: 1, flexWrap: 'wrap' }}><Typography variant="body2" sx={{ fontWeight: 600 }}>{item.label}</Typography><Chip size="small" variant="outlined" label={coverageLabels[item.status]} color={item.status === 'unavailable' || item.status === 'stale' ? 'warning' : 'default'} /></Stack></AccordionSummary>
        <AccordionDetails><Typography variant="caption" component="p">Source: {item.source} · {item.recordCount === null ? 'Record count unavailable' : `${item.recordCount} recorded item${item.recordCount === 1 ? '' : 's'}`}</Typography>{item.evidence.map((evidence, index) => <Typography key={index} variant="body2" color="text.secondary" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{evidence}</Typography>)}</AccordionDetails>
      </Accordion>)}
      {data.warnings.map((warning, index) => <Alert key={index} severity="info" sx={{ mt: 1 }}>{warning}</Alert>)}
    </CardContent></Card>}
  </Box>;
}
