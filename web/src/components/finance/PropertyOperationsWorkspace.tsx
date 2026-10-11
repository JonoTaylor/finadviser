'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import {
  Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent,
  DialogTitle, Divider, Grid, MenuItem, Skeleton, Stack, TextField, Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import { formatCurrency } from '@/lib/utils/formatting';
import type { WorkspaceEnvelope } from '@/lib/finance-workspace/store';
import type { PropertyOperationsWorkspace as OperationsResponse } from '@/lib/property-operations/load';
import { classifyPropertyObligations } from '@/lib/property-operations/engine';
import { propertyObligationSchema, propertyOperationsSchema, type PropertyObligation, type PropertyOperationsData } from '@/lib/property-operations/types';

const categories = ['inspection', 'insurance', 'mortgage', 'tax', 'repair', 'other'] as const;
const displayMoney = (amount: string | null) => amount === null ? 'Not recorded' : formatCurrency(amount);

export default function PropertyOperationsWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<OperationsResponse>('/api/property-operations', fetchJson, { shouldRetryOnError: false });
  const [editing, setEditing] = useState<PropertyObligation | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [reserveProperty, setReserveProperty] = useState<number | null>(null);
  const [reserveValue, setReserveValue] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const obligations = data ? classifyPropertyObligations(data.summary.asOf, data.summary.properties, data.data) : [];

  async function save(next: PropertyOperationsData): Promise<boolean> {
    if (!data || busy) return false;
    setBusy(true);
    setSaveError(null);
    setNotice(null);
    try {
      const saved = await fetchJson<WorkspaceEnvelope<PropertyOperationsData>>('/api/property-operations', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: next, revision: data.revision }),
      });
      await mutate({ ...data, ...saved }, { revalidate: false });
      setNotice('Your property plan has been saved.');
      return true;
    } catch (failure) {
      setSaveError(failure instanceof Error ? failure.message : 'Could not save. Your changes have not been applied.');
      return false;
    } finally { setBusy(false); }
  }

  async function saveObligation() {
    if (!data || !editing) return;
    const parsed = propertyObligationSchema.safeParse(editing);
    if (!parsed.success) { setSaveError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
    const next = isNew ? [...data.data.obligations, parsed.data] : data.data.obligations.map(row => row.id === parsed.data.id ? parsed.data : row);
    if (await save({ ...data.data, obligations: next })) setEditing(null);
  }

  async function saveReserve() {
    if (!data || reserveProperty === null) return;
    const targetAmount = reserveValue.trim() === '' ? null : reserveValue.trim();
    const next = { ...data.data, reserveTargets: [...data.data.reserveTargets.filter(row => row.propertyId !== reserveProperty), { propertyId: reserveProperty, targetAmount }] };
    const parsed = propertyOperationsSchema.safeParse(next);
    if (!parsed.success) { setSaveError('Enter a non-negative reserve amount with up to two decimal places, or leave it blank.'); return; }
    if (await save(parsed.data)) setReserveProperty(null);
  }

  function addObligation() {
    if (!data?.summary.properties.length) return;
    setIsNew(true);
    setSaveError(null);
    setEditing({ id: crypto.randomUUID(), propertyId: data.summary.properties[0].id, title: '', dueDate: data.summary.asOf, category: 'other', status: 'open' });
  }

  return <Box>
    <PageHeader title="Property operations" description="Track scheduled rent, recorded income, upcoming tasks and property reserve targets." actions={<Button component={Link} href="/properties" variant="outlined">Manage properties</Button>} />

    {error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button color="inherit" startIcon={<RefreshRoundedIcon />} onClick={() => void mutate()}>Retry</Button>}>Property data could not be loaded. Rent figures and your saved tasks are unavailable. {error.message}</Alert>}
    {saveError && <Alert severity="error" sx={{ mb: 2 }} action={<Button color="inherit" disabled={busy} onClick={() => void mutate()}>Refresh</Button>}>{saveError}</Alert>}
    {notice && <Alert severity="success" sx={{ mb: 2 }} onClose={() => setNotice(null)}>{notice}</Alert>}
    {isLoading && <Grid container spacing={2}>{[1, 2, 3].map(n => <Grid size={{ xs: n === 1 ? 12 : 6, md: 4 }} key={n}><Skeleton variant="rounded" height={132} /></Grid>)}</Grid>}

    {data && <>
      <Stack direction={{ xs: 'column', sm: 'row' }} gap={0.5} justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="body2" color="text.secondary">Whole property portfolio · as of {data.summary.asOf}</Typography>
        <Typography variant="body2" color="text.secondary">Rent comparison · {data.summary.comparison.month}</Typography>
      </Stack>
      <Grid container spacing={2} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, md: 4 }}><Metric label="Scheduled rent · next 30 days" value={formatCurrency(data.summary.upcoming.total)} detail={`${data.summary.upcoming.startDate} to ${data.summary.upcoming.endDate} · contractual due dates`} /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><Metric label="Overdue tasks" value={String(obligations.filter(row => row.isOverdue).length)} detail="Based on your entered due dates" /></Grid>
        <Grid size={{ xs: 6, md: 4 }}><Metric label="Tasks due within 30 days" value={String(obligations.filter(row => row.isDueSoon).length)} detail="Completed tasks are excluded" /></Grid>
      </Grid>

      {!data.summary.properties.length && <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6">Add your first property</Typography><Typography color="text.secondary" sx={{ my: 1 }}>Add your properties and tenancy contracts to see scheduled rent and create property tasks.</Typography><Button component={Link} href="/properties" variant="contained">Add a property</Button></CardContent></Card>}

      <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mb: 1.5 }}><Typography variant="h6">Rent reconciliation</Typography><Typography variant="body2" color="text.secondary">{data.summary.comparison.month}</Typography></Stack>
      <Alert severity="info" sx={{ mb: 2 }}>An <strong>unreconciled rent gap</strong> compares scheduled rent with recorded property income. Receipts have not been matched to individual tenants. Timing, refunds, other income and missing imports can change this figure.</Alert>
      <Grid container spacing={2} sx={{ mb: 3 }}>{data.summary.properties.map(property => {
        const reserve = data.data.reserveTargets.find(row => row.propertyId === property.id)?.targetAmount ?? null;
        return <Grid key={property.id} size={{ xs: 12, md: 6 }}><Card><CardContent>
          <Stack direction="row" gap={2} justifyContent="space-between" alignItems="flex-start"><Typography variant="subtitle1" component="h2" fontWeight={600} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{property.name}</Typography><Button component={Link} href={`/properties/${property.id}`} size="small" sx={{ flexShrink: 0 }}>Details</Button></Stack>
          <Stack spacing={1.25} sx={{ my: 2 }}>
            <Figure label="Scheduled rent" value={formatCurrency(property.scheduledRent)} />
            <Figure label="Recorded income · receipt proxy" value={displayMoney(property.recordedIncome)} />
            <Figure label="Unreconciled rent gap" value={displayMoney(property.unreconciledRentGap)} />
          </Stack>
          <Typography variant="caption" color="text.secondary" component="p">{property.coverage.firstDate ? `Recorded journals: ${property.coverage.firstDate} to ${property.coverage.lastDate} · ${property.coverage.journalCount} entries. Month completeness is unverified.` : `No property journals recorded for ${data.summary.comparison.month}. Recorded income and the gap remain unknown.`}</Typography>
          <Divider sx={{ my: 2 }} />
          <Stack spacing={1}><Figure label="Recorded loan to value" value={property.loanToValuePercent === null ? 'Not enough data' : `${property.loanToValuePercent}%`} /><Typography variant="caption" color="text.secondary">{property.valuationDate ? `Valuation dated ${property.valuationDate}; mortgage balance as of ${data.summary.asOf}.` : 'Add a dated valuation to calculate loan to value.'} {property.mortgageDebt === null ? 'A mortgage balance could not be assigned safely to this property.' : ''}</Typography>
            <Figure label="Your reserve target" value={reserve === null ? 'Not set' : formatCurrency(reserve)} />
          </Stack>
          <Button size="small" sx={{ mt: 1 }} disabled={busy} onClick={() => { setReserveProperty(property.id); setReserveValue(reserve ?? ''); setSaveError(null); }}>Set reserve target</Button>
          <Typography variant="caption" color="text.secondary" component="p">A planning target only; no money is reserved or added to your balances.</Typography>
        </CardContent></Card></Grid>;
      })}</Grid>

      <Card sx={{ mb: 3 }}><CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={0.5}><Typography variant="h6">Upcoming rent</Typography><Typography variant="body2" color="text.secondary">Next 30 days</Typography></Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>Contract amounts due. This is a schedule, not a forecast of cash received.</Typography>
        {!data.summary.upcoming.lines.length && <Typography color="text.secondary">No contractual rent due dates are recorded in this window. Add or review your tenancy contracts.</Typography>}
        <Stack divider={<Divider />} spacing={1}>{data.summary.upcoming.lines.map(line => <Stack key={`${line.propertyId}-${line.tenancyId}-${line.dueDate}`} direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1} sx={{ py: 1 }}>
          <Box sx={{ minWidth: 0 }}><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{line.propertyName} · {line.tenantName}</Typography><Typography variant="caption" color="text.secondary">Due {line.dueDate} · period {line.periodStart} to {line.periodEnd}</Typography></Box><Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatCurrency(line.amount)}</Typography>
        </Stack>)}</Stack>
      </CardContent></Card>

      <Card><CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} sx={{ mb: 1 }}><Typography variant="h6">Property tasks</Typography><Button startIcon={<AddRoundedIcon />} variant="contained" onClick={addObligation} disabled={busy || !data.summary.properties.length}>Add task</Button></Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Enter dates from your own records. This checklist does not verify statutory deadlines or legal compliance.</Typography>
        {!obligations.length && <Typography color="text.secondary">Add insurance renewals, inspections, mortgage reviews, tax tasks and repairs.</Typography>}
        <Stack spacing={1} divider={<Divider />}>{obligations.map(row => <Stack key={row.id} direction={{ xs: 'column', md: 'row' }} gap={1} justifyContent="space-between" sx={{ py: 1.5 }}>
          <Box sx={{ minWidth: 0 }}><Stack direction="row" alignItems="center" gap={1} flexWrap="wrap"><Typography variant="body2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{row.title}</Typography><Chip size="small" variant="outlined" label={row.status === 'completed' ? 'Completed' : row.isOverdue ? 'Overdue' : row.isDueSoon ? 'Due soon' : 'Open'} color={row.status === 'completed' ? 'success' : row.isOverdue ? 'warning' : 'default'} /></Stack><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5, overflowWrap: 'anywhere' }}>{row.propertyName} · {row.category} · due {row.dueDate}</Typography></Box>
          <Stack direction="row" gap={0.5} flexWrap="wrap" alignItems="center">
            <Button disabled={busy} size="small" onClick={() => void save({ ...data.data, obligations: data.data.obligations.map(item => item.id === row.id ? { ...item, status: item.status === 'open' ? 'completed' : 'open' } : item) })}>{row.status === 'open' ? 'Complete' : 'Reopen'}</Button>
            <Button disabled={busy} size="small" onClick={() => { setIsNew(false); setEditing({ id: row.id, propertyId: row.propertyId, title: row.title, dueDate: row.dueDate, category: row.category, status: row.status }); setSaveError(null); }}>Edit</Button>
            <Button disabled={busy} size="small" color="error" onClick={() => setDeleteId(row.id)}>Delete</Button>
          </Stack>
        </Stack> )}</Stack>
      </CardContent></Card>
      <Stack spacing={1} sx={{ mt: 3 }}>{data.summary.warnings.map(warning => <Typography variant="caption" color="text.secondary" key={warning}>{warning}</Typography>)}</Stack>
    </>}

    <Dialog open={editing !== null} onClose={() => !busy && setEditing(null)} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Add a property task' : 'Edit property task'}</DialogTitle>
      <DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{saveError && <Alert severity="error">{saveError}</Alert>}
        <TextField label="Task title" value={editing?.title ?? ''} disabled={busy} onChange={event => setEditing(value => value && ({ ...value, title: event.target.value }))} inputProps={{ maxLength: 160 }} />
        <TextField select label="Property" value={editing?.propertyId ?? ''} disabled={busy} onChange={event => setEditing(value => value && ({ ...value, propertyId: Number(event.target.value) }))}>{data?.summary.properties.map(property => <MenuItem value={property.id} key={property.id}>{property.name}</MenuItem>)}</TextField>
        <TextField label="Due date" type="date" value={editing?.dueDate ?? ''} disabled={busy} slotProps={{ inputLabel: { shrink: true } }} onChange={event => setEditing(value => value && ({ ...value, dueDate: event.target.value }))} />
        <TextField select label="Category" value={editing?.category ?? 'other'} disabled={busy} onChange={event => setEditing(value => value && ({ ...value, category: event.target.value as PropertyObligation['category'] }))}>{categories.map(category => <MenuItem value={category} key={category}>{category.charAt(0).toUpperCase() + category.slice(1)}</MenuItem>)}</TextField>
        <TextField select label="Status" value={editing?.status ?? 'open'} disabled={busy} onChange={event => setEditing(value => value && ({ ...value, status: event.target.value as PropertyObligation['status'] }))}><MenuItem value="open">Open</MenuItem><MenuItem value="completed">Completed</MenuItem></TextField>
        <Typography variant="caption" color="text.secondary">Use a date you have verified in your records. The app does not verify legal deadlines.</Typography>
      </Stack></DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={busy} variant="contained" onClick={() => void saveObligation()}>{busy ? 'Saving…' : 'Save task'}</Button></DialogActions>
    </Dialog>
    <Dialog open={reserveProperty !== null} onClose={() => !busy && setReserveProperty(null)} fullWidth maxWidth="xs">
      <DialogTitle>Set your property reserve target</DialogTitle><DialogContent><Stack spacing={2} sx={{ pt: 1 }}>{saveError && <Alert severity="error">{saveError}</Alert>}<TextField label="Reserve target (£)" value={reserveValue} disabled={busy} onChange={event => setReserveValue(event.target.value)} slotProps={{ htmlInput: { inputMode: 'decimal' } }} helperText="Leave blank if unknown. This target does not move or allocate money." /></Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setReserveProperty(null)}>Cancel</Button><Button disabled={busy} variant="contained" onClick={() => void saveReserve()}>Save target</Button></DialogActions>
    </Dialog>
    <Dialog open={deleteId !== null} onClose={() => !busy && setDeleteId(null)}><DialogTitle>Delete this property task?</DialogTitle><DialogContent><Typography>The task will be removed from your property plan.</Typography>{saveError && <Alert severity="error" sx={{ mt: 2 }}>{saveError}</Alert>}</DialogContent><DialogActions><Button disabled={busy} onClick={() => setDeleteId(null)}>Cancel</Button><Button color="error" disabled={busy} onClick={async () => { if (data && await save({ ...data.data, obligations: data.data.obligations.filter(row => row.id !== deleteId) })) setDeleteId(null); }}>Delete task</Button></DialogActions></Dialog>
  </Box>;
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <Card sx={{ height: '100%' }}><CardContent><Typography variant="body2" color="text.secondary">{label}</Typography><Typography sx={{ my: 0.75, fontSize: 28, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</Typography><Typography variant="caption" color="text.secondary">{detail}</Typography></CardContent></Card>;
}
function Figure({ label, value }: { label: string; value: string }) {
  return <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>{label}</Typography><Typography variant="body2" fontWeight={600} sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</Typography></Stack>;
}
