'use client';

import { useRef, useState } from 'react';
import useSWR from 'swr';
import {
  Alert, Box, Button, Chip, CircularProgress, Stack, Table, TableBody,
  TableCell, TableContainer, TableHead, TableRow, Typography,
} from '@mui/material';
import { fetchJson } from '@/lib/http/client';
import {
  categorizationModelsResponseSchema,
  type CategorizationModelsResponse,
  type ModelEvaluationResult,
} from '@/lib/ai/categorization-models/types';

const MODELS_URL = '/api/settings/categorization-models';
const responseSchema = categorizationModelsResponseSchema.strip();

export function parseCategorizationModels(value: unknown): CategorizationModelsResponse {
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new Error('The saved model comparison could not be verified. Refresh its status before starting another comparison.');
  return parsed.data;
}

export async function fetchCategorizationModels(url: string): Promise<CategorizationModelsResponse> {
  return parseCategorizationModels(await fetchJson<unknown>(url, { cache: 'no-store' }));
}

function observedDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
  });
}

function latency(value: number): string {
  return value > 0 ? `${(value / 1000).toFixed(value < 1000 ? 2 : 1)} s` : 'Not available';
}

function comparisonCost(value: number | null): string {
  if (value === null) return 'Not available';
  if (value > 0 && value < 0.0001) return '<$0.0001';
  return `$${value.toFixed(4)}`;
}

function ResultRow({ result, name }: { result: ModelEvaluationResult; name: string }) {
  const completed = result.status === 'complete' && result.completedBatches === result.totalBatches;
  const status = result.qualified ? 'Qualified in sample' : result.status === 'timed_out' ? 'Timed out'
    : result.status === 'failed' ? 'Comparison unavailable' : 'Did not qualify';
  return <TableRow>
    <TableCell component="th" scope="row" sx={{ maxWidth: 280, overflowWrap: 'anywhere' }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{name}</Typography>
      <Typography variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>{result.modelId}</Typography>
      <Chip size="small" variant="outlined" color={result.qualified ? 'success' : 'default'} label={status} sx={{ mt: 0.75 }} />
    </TableCell>
    <TableCell>{completed ? `${result.correct}/${result.total} correct` : 'Incomplete'}
      {!completed && <Typography variant="caption" component="p">{result.completedBatches}/{result.totalBatches} batches returned</Typography>}
    </TableCell>
    <TableCell>{result.completedBatches > 0 ? `${result.unsafeAutoApplied} observed${completed ? '' : ' · incomplete'}` : 'Not measured'}</TableCell>
    <TableCell>{result.reviewCount === null ? 'Not measured' : `${result.reviewCount}/${result.total}`}</TableCell>
    <TableCell>{latency(result.meanLatencyMs)}<Typography variant="caption" component="p">mean per batch</Typography></TableCell>
    <TableCell>{comparisonCost(result.estimatedCostUsd)}</TableCell>
  </TableRow>;
}

export function CategorizationModelsDetails({ data, pending = false, onCompare }: {
  data: CategorizationModelsResponse; pending?: boolean; onCompare: () => void;
}) {
  const report = data.lastReport;
  const running = pending || data.running !== null;
  const source = data.active.source === 'qualified' ? 'Measured selection'
    : data.active.source === 'env' ? 'Workspace override' : 'Default · not benchmark-selected';
  const comparedAt = observedDate(report?.completedAt ?? null);
  const catalogAt = observedDate(data.catalog.observedAt);
  return <Stack spacing={2}>
    <Typography variant="body2" color="text.secondary">
      Confirmed payment knowledge is used first. Compare available models through Vercel AI Gateway using ten synthetic payment examples, then save a qualified recommendation.
    </Typography>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap">
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Current categorisation model</Typography>
      <Chip size="small" variant="outlined" label={source} />
      <Typography variant="body2" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere', minWidth: 0 }}>{data.active.modelId}</Typography>
    </Stack>
    {data.active.source === 'env' && <Alert severity="info">A workspace override is active. Comparisons can be saved, but they will not change the active model until that override is removed.</Alert>}
    {!data.gatewayConfigured && <Alert severity="info">AI Gateway access is unavailable on this server. No model comparison has been assumed.</Alert>}
    {data.catalog.status === 'unavailable' && <Alert severity="warning">The current Gateway catalogue could not be loaded. Existing saved results remain visible; model availability is unverified.</Alert>}
    {data.catalog.status === 'available' && <Typography variant="caption" component="p">Gateway catalogue checked {catalogAt ?? 'at an unavailable time'} UK time · {data.catalog.models.length} models listed.</Typography>}
    {running && <Alert severity="info" icon={<CircularProgress size={18} />}>Comparing models. The current selection stays in use until a qualified result is saved.</Alert>}
    {!report && !running && <Typography variant="body2">No completed comparison is saved yet. Accuracy, speed and cost have not been measured for this workspace.</Typography>}
    {report && <Box>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>Last comparison{comparedAt ? ` · ${comparedAt} UK time` : ''}</Typography>
      <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>Test set: {report.benchmarkVersion} · 10 synthetic examples · up to 3 models.</Typography>
      {report.results.length > 0 && <TableContainer sx={{ mt: 1.5 }}><Table size="small" aria-label="Categorisation model comparison" sx={{ minWidth: 760 }}>
        <TableHead><TableRow>
          <TableCell>Model</TableCell><TableCell>Test decisions</TableCell><TableCell>Unsafe auto-assignments</TableCell>
          <TableCell>Sent for review</TableCell><TableCell>Response time</TableCell><TableCell>Estimated test cost (USD)</TableCell>
        </TableRow></TableHead>
        <TableBody>{report.results.map(result => <ResultRow key={result.modelId} result={result} name={data.catalog.models.find(model => model.id === result.modelId)?.name ?? result.modelId} />)}</TableBody>
      </Table></TableContainer>}
      <Alert severity={report.status === 'unavailable' ? 'warning' : report.recommendedModelId ? 'success' : 'info'} sx={{ mt: 1.5 }}>{report.message}</Alert>
      {report.recommendedModelId && <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>
        {report.applied ? 'Saved recommendation' : 'Recommended in this comparison'}: {report.recommendedModelId}
      </Typography>}
      <Typography variant="caption" component="p" sx={{ mt: 1 }}>These are results from a small synthetic sample, not a guarantee of accuracy on your payments. Some examples should stay in review. The review count is for this test set, not your transaction backlog.</Typography>
    </Box>}
    <Box><Button variant="outlined" disabled={running || !data.gatewayConfigured} onClick={onCompare}>{running ? 'Comparing models…' : 'Compare models'}</Button>
      <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>Uses your Gateway account for a bounded comparison. Your bank transactions are not sent as test examples. A qualifying recommendation is saved automatically.</Typography>
    </Box>
  </Stack>;
}

export default function CategorizationModels() {
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState('');
  const writing = useRef(false);
  const { data, error, isLoading, mutate } = useSWR(MODELS_URL, fetchCategorizationModels, {
    shouldRetryOnError: false, refreshInterval: latest => pending || latest?.running ? 3000 : 0,
    refreshWhenHidden: false,
  });
  const compare = async () => {
    if (!data || writing.current || data.running || !data.gatewayConfigured) return;
    writing.current = true;
    setPending(true);
    setActionError('');
    try {
      const result = parseCategorizationModels(await fetchJson<unknown>(MODELS_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expectedRevision: data.revision, applyRecommendation: true }),
      }));
      await mutate(result, { revalidate: false });
    } catch {
      setActionError('The comparison request could not be confirmed. Refresh the saved results before starting another comparison.');
      // Read once after an uncertain paid request; never automatically replay it.
      await mutate().catch(() => undefined);
    } finally {
      writing.current = false;
      setPending(false);
    }
  };
  if (isLoading && !data) return <Stack direction="row" gap={1.5} alignItems="center"><CircularProgress size={18} /><Typography variant="body2">Loading saved categorisation model results…</Typography></Stack>;
  if (!data) return <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Refresh</Button>}>Saved model comparison results could not be loaded. No comparison or model switch has been assumed.</Alert>;
  return <>
    {error && <Alert severity="warning" sx={{ mb: 2 }}>Current comparison status could not be refreshed. The saved results below may be out of date.</Alert>}
    {actionError && <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => void mutate()}>Refresh results</Button>}>{actionError}</Alert>}
    <CategorizationModelsDetails data={data} pending={pending} onCompare={() => void compare()} />
  </>;
}
