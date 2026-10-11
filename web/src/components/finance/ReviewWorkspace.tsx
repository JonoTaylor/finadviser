'use client';

import { useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card,
  CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  MenuItem, Skeleton, Stack, Tab, Tabs, TextField, Typography,
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import { formatCurrency } from '@/lib/utils/formatting';
import { softTokens, serifFamily } from '@/theme/theme';
import { actionReviewState } from '@/lib/finance-reviews/engine';
import {
  actionRecordSchema, recurringReviewSchema, reviewsDataSchema,
  type ActionRecord, type ReviewsData, type ReviewSnapshot,
} from '@/lib/finance-reviews/schema';
import type { ReviewsOverview } from '@/lib/finance-reviews/load';
import type { WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import type { RecurringCandidate } from '@/lib/planning/types';

type QueueEntry = ReviewsOverview['actionQueue'][number];
type RecurringRecord = ReviewsData['recurring'][number];
type Editable = Pick<ReviewsData, 'actions' | 'recurring'>;
type Filter = 'open' | 'all' | ActionRecord['status'];
const statusLabels: Record<ActionRecord['status'], string> = {
  planned: 'Planned', in_progress: 'In progress', completed: 'Completed', deferred: 'Deferred', dismissed: 'Dismissed',
};
const recurringLabels = { confirmed: 'Confirmed recurring payment', dismissed: 'Dismissed candidate', changed: 'Changed or cancelled' };
const featureLabels = { debts: 'Debt terms', portfolio: 'Investment holdings', pensions: 'Pension records', property: 'Property operations', goals: 'Savings goals' };
const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const timeLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(iso));
const amountLabel = (amount: number | string | null) => amount === null ? 'Unknown' : formatCurrency(amount);
const changeLabel = (amount: string | null) => amount === null ? 'Unknown' : `${Number(amount) > 0 ? '+' : ''}${formatCurrency(amount)}`;

class ReviewSaveError extends Error {
  constructor(message: string, readonly conflict: boolean) { super(message); }
}

async function writeReviews(method: 'PUT' | 'POST', body: unknown): Promise<{ workspace: WorkspaceEnvelope<ReviewsData>; overview: ReviewsOverview | null }> {
  const response = await fetch('/api/reviews', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new ReviewSaveError(typeof result?.error === 'string' ? result.error : 'Your review could not be saved. Please retry.', response.status === 409);
  const workspace = result?.workspace ?? result;
  if (workspace?.version !== 1 || !Number.isInteger(workspace?.revision) || !reviewsDataSchema.safeParse(workspace?.data).success) {
    throw new ReviewSaveError('The save response could not be read. Reload the saved version before trying again.', true);
  }
  return { workspace, overview: result?.plan && result?.actionQueue ? result as ReviewsOverview : null };
}

export default function ReviewWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<ReviewsOverview>('/api/reviews', fetchJson, {
    shouldRetryOnError: false, revalidateOnFocus: false,
  });
  const [filter, setFilter] = useState<Filter>('open');
  const [editor, setEditor] = useState<{ kind: 'action'; entry: QueueEntry } | { kind: 'recurring'; candidate: RecurringCandidate | null; record: RecurringRecord | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [notice, setNotice] = useState('');
  const [writeError, setWriteError] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [conflict, setConflict] = useState(false);

  async function reload(): Promise<ReviewsOverview> {
    const latest = await fetchJson<ReviewsOverview>('/api/reviews');
    await mutate(latest, { revalidate: false });
    setRefreshError('');
    setWriteError('');
    setConflict(false);
    return latest;
  }

  async function acceptSaved(result: Awaited<ReturnType<typeof writeReviews>>, captured = false) {
    if (result.overview) {
      await mutate(result.overview, { revalidate: false });
    } else {
      await mutate(current => current ? {
        ...current, workspace: result.workspace,
        actionQueue: current.actionQueue.map(entry => ({ ...entry, state: actionReviewState({ id: entry.action.id, evidenceFingerprint: entry.evidenceFingerprint }, result.workspace.data.actions, current.plan.asOf) })),
        comparison: captured ? null : current.comparison,
      } : current, { revalidate: false });
      try { await reload(); } catch {
        setRefreshError('Your changes were saved, but the latest financial evidence could not be refreshed. Reload before making another change.');
      }
    }
  }

  async function persist(editable: Editable, revision: number) {
    if (writing.current) throw new ReviewSaveError('A review change is already being saved.', false);
    writing.current = true;
    setBusy(true);
    setNotice('');
    try {
      const result = await writeReviews('PUT', { revision, data: editable });
      await acceptSaved(result);
      setNotice('Your review notes and action status have been saved.');
    } finally { writing.current = false; setBusy(false); }
  }

  async function capture() {
    if (!data || writing.current) return;
    writing.current = true;
    setBusy(true);
    setNotice('');
    setWriteError('');
    try {
      const result = await writeReviews('POST', { revision: data.workspace.revision });
      await acceptSaved(result, true);
      setNotice('A household review was captured from the latest recorded data.');
      setConflict(false);
    } catch (caught) {
      setWriteError(caught instanceof Error ? caught.message : 'Your review could not be captured.');
      setConflict(caught instanceof ReviewSaveError && caught.conflict);
    } finally { writing.current = false; setBusy(false); }
  }

  async function download() {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    setWriteError('');
    try {
      const response = await fetch('/api/finance/export');
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Your planning export is unavailable.');
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `finadviser-planning-${data?.plan.asOf ?? 'records'}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setNotice('Your planning export has been downloaded. It is not a complete ledger backup.');
    } catch (caught) {
      setWriteError(caught instanceof Error ? caught.message : 'Your planning export could not be downloaded.');
    } finally { writing.current = false; setBusy(false); }
  }

  const disabled = busy || Boolean(refreshError || conflict || error);
  const snapshots = [...(data?.workspace.data.snapshots ?? [])].sort((left, right) => right.recordedAt.localeCompare(left.recordedAt));
  const latest = snapshots[0] ?? null;
  const visible = data?.actionQueue.filter(entry => filter === 'all' || filter === 'open' ? filter === 'all' || ['planned', 'in_progress'].includes(entry.state.status) : entry.state.status === filter) ?? [];
  const storedOutsideQueue = data?.workspace.data.actions.filter(record => !data.actionQueue.some(entry => entry.action.id === record.id)) ?? [];
  const recurringRecords = data?.workspace.data.recurring ?? [];
  const unavailableFeatures = data ? Object.entries(data.features).filter(([, feature]) => feature.status === 'unavailable').map(([key]) => featureLabels[key as keyof typeof featureLabels] ?? key) : [];
  const omittedRecurring = recurringRecords.filter(record => !data?.recurringCandidates.some(candidate => candidate.merchant.toLowerCase() === record.merchant.toLowerCase()));

  return (
    <Box sx={{ pt: { xs: 4, md: 0 } }}>
      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', md: 'center' }} gap={2} sx={{ mb: 3 }}>
        <Box><Typography variant="overline" sx={{ color: softTokens.mint.ink, letterSpacing: '0.14em' }}>Make progress, then review it</Typography><Typography variant="h4" component="h1">Your financial review</Typography><Typography variant="body2" sx={{ mt: 1, maxWidth: 720 }}>Turn your plan into manageable actions, review recurring payments, and keep a dated record of your financial picture.</Typography></Box>
        <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ flexShrink: 0 }}><Button variant="outlined" startIcon={<DownloadRoundedIcon />} onClick={() => void download()} disabled={!data || disabled}>Download planning export</Button><Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => void capture()} disabled={!data || disabled}>{busy && !editor ? 'Working…' : 'Capture financial review'}</Button></Stack>
      </Stack>
      {isLoading && !data ? <Stack gap={3}><Skeleton variant="rounded" height={180} /><Skeleton variant="rounded" height={360} /></Stack> : error && !data ? <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your financial review could not be loaded. Your saved actions and household figures are unavailable. {error.message}</Alert> : data ? <>
        {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 2 }}>{notice}</Alert>}
        {(writeError || refreshError || error) && <Alert severity={conflict ? 'warning' : 'error'} sx={{ mb: 2 }}>{writeError || refreshError || error?.message}{conflict && ' A newer version was saved in another session. Reload it before capturing another review.'}<Box sx={{ mt: 1 }}><Button size="small" disabled={busy} onClick={() => void reload().catch(caught => setRefreshError(caught instanceof Error ? caught.message : 'The review could not be reloaded.'))}>Reload saved review</Button></Box></Alert>}
        <Card sx={{ mb: 3, bgcolor: softTokens.cream }}><CardContent>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ mb: 2 }}><Box><Typography variant="h6" component="h2">Current recorded household picture</Typography><Typography variant="caption">Balances as at {dateLabel(data.plan.asOf)} · GBP · household scope</Typography></Box><Chip size="small" label={data.context.data.nextReviewDate ? `Next review ${dateLabel(data.context.data.nextReviewDate)}` : 'Next review date not set'} variant="outlined" sx={{ alignSelf: 'flex-start' }} /></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={3}>{[
            ['Monthly spending', data.plan.cashflow.monthlySpending], ['Monthly surplus', data.plan.cashflow.monthlySurplus], ['Recorded net worth', data.plan.balanceSheet.netWorth],
          ].map(([label, amount]) => <Box key={String(label)} sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption">{label}</Typography><Typography variant="h3" sx={{ fontFamily: serifFamily, mt: 0.5, overflowWrap: 'anywhere' }}>{amountLabel(amount as number | null)}</Typography></Box>)}</Stack>
          <Divider sx={{ my: 2 }} /><Typography variant="body2">Cashflow period: {dateLabel(data.plan.cashflow.recentPeriod.start)} to {dateLabel(data.plan.cashflow.recentPeriod.end)} · {data.plan.coverage.recentMonthsWithData} of 3 months with recorded activity. Missing months are not treated as zero spending.</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>Net worth is the sum of known recorded household values. New deposits, debts, missing accounts and valuation changes affect it; it is not a measure of investment returns.</Typography>
        </CardContent></Card>
        {unavailableFeatures.length > 0 && <Alert severity="warning" sx={{ mb: 2 }}>Some evidence is unavailable: {unavailableFeatures.join(', ')}. Related conclusions remain incomplete; an unavailable record is not an empty record.</Alert>}
        {data.warnings.length > 0 && <Accordion sx={{ mb: 3 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="subtitle2">Evidence &amp; coverage notes ({data.warnings.length})</Typography></AccordionSummary><AccordionDetails><Stack gap={1}>{data.warnings.map((warning, index) => <Typography key={`${index}-${warning}`} variant="body2">{warning}</Typography>)}</Stack></AccordionDetails></Accordion>}

        <Typography variant="h6" component="h2">Your action queue</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>A completed task records what you did. It does not certify that a financial risk has been resolved. Changed evidence and due deferred actions return to your open queue.</Typography>
        <Tabs value={filter} onChange={(_, value) => setFilter(value)} variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile aria-label="Filter actions by status" sx={{ mb: 2 }}>
          {(['open', 'all', 'planned', 'in_progress', 'completed', 'deferred', 'dismissed'] as const).map(value => <Tab key={value} value={value} label={`${value === 'open' ? 'Open' : value === 'all' ? 'All actions' : statusLabels[value]} (${data.actionQueue.filter(entry => value === 'all' || value === 'open' ? value === 'all' || ['planned', 'in_progress'].includes(entry.state.status) : entry.state.status === value).length})`} sx={{ textTransform: 'none' }} />)}
        </Tabs>
        {visible.length === 0 ? <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6">No {filter === 'all' ? 'current' : filter === 'open' ? 'open' : statusLabels[filter].toLowerCase()} actions</Typography><Typography variant="body2" sx={{ mt: 1 }}>Review your other statuses and the evidence coverage before drawing conclusions about your finances.</Typography></CardContent></Card> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2, mb: 3 }}>{visible.map(entry => <Card key={entry.action.id} component="article" aria-label={entry.action.title}><CardContent>
          <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1.5 }}><Chip size="small" label={`${entry.action.priority[0].toUpperCase() + entry.action.priority.slice(1)} priority`} color={entry.action.priority === 'high' ? 'warning' : 'default'} /><Chip size="small" label={statusLabels[entry.state.status]} variant="outlined" />{entry.state.saved?.dueDate && <Chip size="small" label={`Review ${dateLabel(entry.state.saved.dueDate)}`} variant="outlined" />}</Stack>
          <Typography variant="h6" component="h3">{entry.action.title}</Typography><Typography variant="body2" sx={{ mt: 1 }}>{entry.action.detail}</Typography><Box sx={{ bgcolor: softTokens.cream, p: 2, borderRadius: 2, mt: 2 }}><Typography variant="caption" sx={{ display: 'block', mb: 0.5 }}>Evidence behind this action</Typography><Typography variant="body2">{entry.action.evidence}</Typography></Box>
          {(entry.state.evidenceChanged || entry.state.reviewDue) && <Alert severity="info" sx={{ mt: 2 }}>{entry.state.evidenceChanged ? `The evidence changed after you recorded this as ${statusLabels[entry.state.recordedStatus!].toLowerCase()}. Review the new facts.` : 'The date you chose to revisit this action has arrived.'}</Alert>}
          {entry.state.saved?.note && <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Your note: {entry.state.saved.note}</Typography>}
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mt: 2 }}><Button size="small" component={Link} href={entry.action.href} endIcon={<ArrowForwardRoundedIcon />}>{entry.action.actionLabel}</Button><Button size="small" variant="outlined" startIcon={<EditRoundedIcon />} onClick={() => setEditor({ kind: 'action', entry })} disabled={disabled}>Update action</Button></Stack>
        </CardContent></Card>)}</Box>}
        {storedOutsideQueue.length > 0 && <Accordion sx={{ mb: 3 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="subtitle2">Previously saved actions outside the current plan ({storedOutsideQueue.length})</Typography></AccordionSummary><AccordionDetails><Stack gap={2}>{storedOutsideQueue.map(record => <Box key={record.id}><Typography variant="subtitle2">{record.id} · {statusLabels[record.status]}</Typography><Typography variant="caption">No current recommendation is returned for this saved action.{record.dueDate ? ` Review date: ${dateLabel(record.dueDate)}.` : ''}</Typography>{record.note && <Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.note}</Typography>}</Box>)}</Stack></AccordionDetails></Accordion>}

        <Typography variant="h6" component="h2">Review recurring payments</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>A recurring merchant is a candidate to review, rather than a proven cancellable subscription. Record what you checked and any saving you intend to make.</Typography>
        {data.recurringCandidates.length === 0 ? <Alert severity="info" sx={{ mb: 2 }}>No recurring candidates were returned for the observed period. This does not prove that you have no subscriptions.</Alert> : <Stack gap={2} sx={{ mb: 3 }}>{data.recurringCandidates.map(candidate => {
          const record = recurringRecords.find(item => item.merchant.toLowerCase() === candidate.merchant.toLowerCase());
          return <Card key={candidate.merchant} component="article" aria-label={`Recurring ${candidate.merchant}`}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }} gap={2}><Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="h6" component="h3">{candidate.merchant}</Typography><Typography variant="caption">{candidate.category} · typical observed payment {amountLabel(candidate.typicalPayment)} · {candidate.paymentCount} payments</Typography></Box><Chip size="small" label={record ? recurringLabels[record.status] : 'Needs your confirmation'} variant="outlined" sx={{ alignSelf: 'flex-start' }} /></Stack><Typography variant="body2" sx={{ mt: 1.5 }}>{candidate.evidence}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>Observed dates: {candidate.dates.map(dateLabel).join(', ')}</Typography>{record?.note && <Typography variant="body2" sx={{ mt: 1, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>Your note: {record.note}</Typography>}{record?.expectedMonthlySaving !== null && record?.expectedMonthlySaving !== undefined && <Typography variant="body2" sx={{ mt: 1 }}>Intended monthly saving: {amountLabel(record.expectedMonthlySaving)} · not a realised saving</Typography>}<Button size="small" variant="outlined" startIcon={<EditRoundedIcon />} disabled={disabled} onClick={() => setEditor({ kind: 'recurring', candidate, record: record ?? null })} sx={{ mt: 2 }}>Review payment</Button></CardContent></Card>;
        })}</Stack>}
        {omittedRecurring.length > 0 && <Accordion sx={{ mb: 3 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="subtitle2">Saved payment reviews outside the current candidates ({omittedRecurring.length})</Typography></AccordionSummary><AccordionDetails><Stack gap={2}>{omittedRecurring.map(record => <Box key={record.merchant}><Typography variant="subtitle2">{record.merchant} · {recurringLabels[record.status]}</Typography><Typography variant="caption">No current recurring candidate is returned for this merchant.</Typography>{record.note && <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', mt: 0.5 }}>{record.note}</Typography>}<Button size="small" disabled={disabled} onClick={() => setEditor({ kind: 'recurring', candidate: null, record })}>Edit saved payment review</Button></Box>)}</Stack></AccordionDetails></Accordion>}

        <ComparisonCard data={data} latest={latest} />
        <Typography variant="h6" component="h2" sx={{ mb: 2 }}>Captured review history ({snapshots.length})</Typography>
        {snapshots.length === 0 ? <Card><CardContent><Typography variant="body2">Capture your first review to keep a dated baseline. A snapshot records the evidence available at that moment; it does not fill missing information.</Typography></CardContent></Card> : <Stack gap={2}>{snapshots.map(snapshot => <SnapshotCard key={snapshot.id} snapshot={snapshot} />)}</Stack>}
        <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Planning exports contain saved planning records and summaries. They are not a full ledger backup. Keep downloaded financial records somewhere private.</Typography>
      </> : null}
      {editor && data && (editor.kind === 'action' ? <ActionEditor key={editor.entry.action.id} entry={editor.entry} overview={data} onSave={persist} onReload={reload} onClose={() => setEditor(null)} /> : <RecurringEditor key={editor.candidate?.merchant ?? editor.record?.merchant} candidate={editor.candidate} record={editor.record} overview={data} onSave={persist} onReload={reload} onClose={() => setEditor(null)} />)}
    </Box>
  );
}

function ComparisonCard({ data, latest }: { data: ReviewsOverview; latest: ReviewSnapshot | null }) {
  const comparison = data.comparison;
  return <Card sx={{ my: 3 }}><CardContent><Typography variant="h6" component="h2">Changes since your last captured review</Typography>{!comparison || !latest ? <Typography variant="body2" sx={{ mt: 1 }}>{latest ? 'Refresh the current evidence to compare it with your captured baseline.' : 'Capture a review to start a comparison. Unknown figures stay unknown.'}</Typography> : <>
    <Typography variant="body2" sx={{ mt: 1 }}>Baseline balances: {dateLabel(comparison.previousAsOf)} · current balances: {dateLabel(comparison.currentAsOf)}. Both reviews use recorded household values.</Typography>
    <Box sx={{ bgcolor: softTokens.cream, p: 2, borderRadius: 2, mt: 2 }}><Typography variant="body2">Baseline cashflow: {dateLabel(comparison.previousPeriod.start)} to {dateLabel(comparison.previousPeriod.end)} · {comparison.previousPeriod.monthsRecorded} of 3 months recorded.</Typography><Typography variant="body2" sx={{ mt: 0.5 }}>Current cashflow: {dateLabel(comparison.currentPeriod.start)} to {dateLabel(comparison.currentPeriod.end)} · {comparison.currentPeriod.monthsRecorded} of 3 months recorded.</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{comparison.samePeriod ? 'These cashflow windows are the same. Changes can reflect corrections or newly imported records.' : 'These cashflow windows differ. A change can reflect the period covered, as well as different spending.'}</Typography></Box>
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', xl: 'repeat(5, minmax(0, 1fr))' }, gap: 2, mt: 2 }}>{[
      ['Monthly spending', comparison.monthlySpending], ['Monthly surplus', comparison.monthlySurplus], ['Cash reserve shortfall', comparison.reserveShortfall], ['Recorded net worth', comparison.netWorth], ['Recorded debt', comparison.debt],
    ].map(([label, value]) => <Box key={String(label)} sx={{ minWidth: 0 }}><Typography variant="caption">{label}</Typography><Typography variant="h5" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{changeLabel(value)}</Typography><Typography variant="caption">Change in recorded amount</Typography></Box>)}</Box><Typography variant="caption" sx={{ display: 'block', mt: 2 }}>{comparison.basis}</Typography>
  </>}</CardContent></Card>;
}

function SnapshotCard({ snapshot }: { snapshot: ReviewSnapshot }) {
  return <Card component="article" aria-label={`Review ${dateLabel(snapshot.asOf)}`}><CardContent>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box><Typography variant="h6" component="h3">{dateLabel(snapshot.asOf)}</Typography><Typography variant="caption">Captured {timeLabel(snapshot.recordedAt)} · household · GBP</Typography></Box><Chip label={`${snapshot.period.monthsRecorded}/3 cashflow months recorded`} size="small" variant="outlined" sx={{ alignSelf: 'flex-start' }} /></Stack>
    <Typography variant="body2" sx={{ mt: 1.5 }}>Cashflow period: {dateLabel(snapshot.period.start)} to {dateLabel(snapshot.period.end)}</Typography>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={3} sx={{ mt: 2 }}>{[['Monthly spending', snapshot.metrics.monthlySpending], ['Monthly surplus', snapshot.metrics.monthlySurplus], ['Recorded net worth', snapshot.metrics.netWorth]].map(([label, amount]) => <Box key={String(label)} sx={{ flex: 1, minWidth: 0 }}><Typography variant="caption">{label}</Typography><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{amountLabel(amount)}</Typography></Box>)}</Stack>
    <Accordion elevation={0} sx={{ mt: 2 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="caption">Captured savings goal progress</Typography></AccordionSummary><AccordionDetails>
      {!snapshot.goals ? <Typography variant="body2">Goal progress was not captured in this older review.</Typography> : snapshot.goals.status === 'unavailable' ? <Alert severity="warning">Goal progress was unavailable when this review was captured. {snapshot.goals.error}</Alert> : <Stack gap={2}>
        <Typography variant="caption">These are recorded manual allocations to goals. They are not additional account balances or net worth.</Typography>
        {snapshot.goals.data.goals.length === 0 ? <Typography variant="body2">No savings goals were recorded when this review was captured.</Typography> : snapshot.goals.data.goals.map(goal => <Box key={goal.id}><Typography variant="subtitle2">{goal.name} · {goal.status}</Typography><Typography variant="body2">{amountLabel(goal.currentAmount)} recorded against a {amountLabel(goal.targetAmount)} target{goal.progressPercent === null ? ' · progress unknown' : ` · ${Math.floor(goal.progressPercent)}% funded`}</Typography><Typography variant="caption">{goal.targetDate ? `Target date ${dateLabel(goal.targetDate)}` : 'No target date'}</Typography></Box>)}
      </Stack>}
    </AccordionDetails></Accordion>
    {snapshot.warnings.length > 0 && <Accordion elevation={0} sx={{ mt: 1 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography variant="caption">Snapshot coverage notes ({snapshot.warnings.length})</Typography></AccordionSummary><AccordionDetails><Stack gap={1}>{snapshot.warnings.map((warning, index) => <Typography key={`${index}-${warning}`} variant="body2">{warning}</Typography>)}</Stack></AccordionDetails></Accordion>}
  </CardContent></Card>;
}

function EditorError({ message, conflict, busy, onReload }: { message: string; conflict: boolean; busy: boolean; onReload: () => void }) {
  return message ? <Alert severity={conflict ? 'warning' : 'error'}>{message} {conflict ? 'Your entries are preserved. Reloading replaces them with the latest saved version.' : 'Your entries are still here.'}{conflict && <Box sx={{ mt: 1 }}><Button size="small" disabled={busy} onClick={onReload}>Reload saved version</Button></Box>}</Alert> : null;
}

interface EditorProps {
  overview: ReviewsOverview;
  onSave: (editable: Editable, revision: number) => Promise<void>;
  onReload: () => Promise<ReviewsOverview>;
  onClose: () => void;
}

function ActionEditor({ entry, overview, onSave, onReload, onClose }: EditorProps & { entry: QueueEntry }) {
  const saved = entry.state.saved;
  const [form, setForm] = useState({ status: entry.state.status, dueDate: saved?.dueDate ?? '', note: saved?.note ?? '' });
  const [base, setBase] = useState(overview.workspace);
  const [fingerprint, setFingerprint] = useState(entry.evidenceFingerprint);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (writing.current || conflict) return;
    const parsed = actionRecordSchema.safeParse({ id: entry.action.id, status: form.status, dueDate: form.dueDate || null, note: form.note, evidenceFingerprint: fingerprint });
    if (!parsed.success) { setIssues(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return; }
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave({ actions: [...base.data.actions.filter(record => record.id !== parsed.data.id), parsed.data], recurring: base.data.recurring }, base.revision);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Your action could not be saved.');
      setConflict(caught instanceof ReviewSaveError && caught.conflict);
    } finally { writing.current = false; setBusy(false); }
  };
  const reload = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      const latest = await onReload();
      const refreshed = latest.actionQueue.find(item => item.action.id === entry.action.id);
      const record = latest.workspace.data.actions.find(item => item.id === entry.action.id);
      setForm({ status: refreshed?.state.status ?? record?.status ?? 'planned', dueDate: record?.dueDate ?? '', note: record?.note ?? '' });
      setFingerprint(refreshed?.evidenceFingerprint ?? entry.evidenceFingerprint);
      setBase(latest.workspace);
      setIssues({}); setError(''); setConflict(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The saved version could not be reloaded.'); }
    finally { writing.current = false; setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!writing.current) onClose(); }} disableEscapeKeyDown={busy} aria-labelledby="action-editor-title"><Box component="form" onSubmit={submit} noValidate><DialogTitle id="action-editor-title">Update action</DialogTitle><DialogContent><Stack gap={2.5} sx={{ pt: 1 }}><Typography variant="subtitle2">{entry.action.title}</Typography><EditorError message={error} conflict={conflict} busy={busy} onReload={() => void reload()} /><TextField select label="Action status" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as ActionRecord['status'] }))} disabled={busy}>{Object.entries(statusLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField label="Review / due date (optional)" type="date" value={form.dueDate} onChange={event => { setForm(current => ({ ...current, dueDate: event.target.value })); setIssues(current => ({ ...current, dueDate: '' })); }} disabled={busy} error={Boolean(issues.dueDate)} helperText={issues.dueDate || 'Required when deferred. On that date, the action returns to your open queue.'} slotProps={{ inputLabel: { shrink: true } }} /><TextField label="Your action note" multiline minRows={3} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} disabled={busy} error={Boolean(issues.note)} helperText={issues.note || 'Record what you checked, changed or plan to do.'} slotProps={{ htmlInput: { maxLength: 2000 } }} /><Typography variant="caption">Completion organises your work. The underlying financial condition remains determined by your recorded evidence.</Typography></Stack></DialogContent><DialogActions sx={{ px: 3, pb: 3 }}><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="contained" disabled={busy || conflict}>{busy ? 'Saving…' : 'Save action'}</Button></DialogActions></Box></Dialog>;
}

function RecurringEditor({ candidate, record, overview, onSave, onReload, onClose }: EditorProps & { candidate: RecurringCandidate | null; record: RecurringRecord | null }) {
  const merchant = candidate?.merchant ?? record!.merchant;
  const [form, setForm] = useState({ status: record?.status ?? 'confirmed', note: record?.note ?? '', expectedMonthlySaving: record?.expectedMonthlySaving ?? '' });
  const [base, setBase] = useState(overview.workspace);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (writing.current || conflict) return;
    const parsed = recurringReviewSchema.safeParse({ merchant, status: form.status, note: form.note, expectedMonthlySaving: form.expectedMonthlySaving.trim() || null });
    if (!parsed.success) { setIssues(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message]))); return; }
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave({ actions: base.data.actions, recurring: [...base.data.recurring.filter(item => item.merchant.toLowerCase() !== merchant.toLowerCase()), parsed.data] }, base.revision);
      onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Your payment review could not be saved.'); setConflict(caught instanceof ReviewSaveError && caught.conflict); }
    finally { writing.current = false; setBusy(false); }
  };
  const reload = async () => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true);
    try {
      const latest = await onReload();
      const current = latest.workspace.data.recurring.find(item => item.merchant.toLowerCase() === merchant.toLowerCase());
      setForm({ status: current?.status ?? 'confirmed', note: current?.note ?? '', expectedMonthlySaving: current?.expectedMonthlySaving ?? '' });
      setBase(latest.workspace); setIssues({}); setError(''); setConflict(false);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'The saved version could not be reloaded.'); }
    finally { writing.current = false; setBusy(false); }
  };
  return <Dialog open fullWidth maxWidth="sm" onClose={() => { if (!writing.current) onClose(); }} disableEscapeKeyDown={busy} aria-labelledby="recurring-editor-title"><Box component="form" onSubmit={submit} noValidate><DialogTitle id="recurring-editor-title">Review recurring payment</DialogTitle><DialogContent><Stack gap={2.5} sx={{ pt: 1 }}><Typography variant="subtitle2">{merchant}</Typography>{candidate && <Typography variant="body2">{candidate.evidence}</Typography>}<EditorError message={error} conflict={conflict} busy={busy} onReload={() => void reload()} /><TextField select label="Payment review outcome" value={form.status} onChange={event => setForm(current => ({ ...current, status: event.target.value as RecurringRecord['status'] }))} disabled={busy}>{Object.entries(recurringLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}</TextField><TextField label="Intended monthly saving (£, optional)" value={form.expectedMonthlySaving} onChange={event => { setForm(current => ({ ...current, expectedMonthlySaving: event.target.value })); setIssues(current => ({ ...current, expectedMonthlySaving: '' })); }} disabled={busy} error={Boolean(issues.expectedMonthlySaving)} helperText={issues.expectedMonthlySaving || 'Your intention only. This amount is not treated as realised savings or added to your net worth.'} slotProps={{ htmlInput: { inputMode: 'decimal' } }} /><TextField label="Your payment review note" multiline minRows={3} value={form.note} onChange={event => setForm(current => ({ ...current, note: event.target.value }))} disabled={busy} error={Boolean(issues.note)} slotProps={{ htmlInput: { maxLength: 2000 } }} /><Typography variant="caption">Recording “changed or cancelled” does not contact the merchant, cancel a contract, or change your ledger.</Typography></Stack></DialogContent><DialogActions sx={{ px: 3, pb: 3 }}><Button disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" variant="contained" disabled={busy || conflict}>{busy ? 'Saving…' : 'Save payment review'}</Button></DialogActions></Box></Dialog>;
}
