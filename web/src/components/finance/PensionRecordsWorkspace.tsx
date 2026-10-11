'use client';

import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, MenuItem, Skeleton, Snackbar, Stack, TextField, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import { londonTodayIso } from '@/lib/dates/today';
import { formatCurrency } from '@/lib/utils/formatting';
import { pensionRecordSchema, pensionRecordsDataSchema, type PensionRecord, type PensionRecordType } from '@/lib/pension-records/schema';
import { pensionRecordDraft, pensionRecordFromDraft, type PensionRecordDraft } from '@/lib/pension-records/editor';
import { pensionRecordOwnerId, pensionRecordPot, summarizePensionRecords, type PensionAmountSummary } from '@/lib/pension-records/summary';
import type { PensionRecordsWorkspace as WorkspaceData } from '@/lib/pension-records/load';
import PageHeader from '@/components/ui/PageHeader';

const typeNames: Record<PensionRecordType, string> = { dc: 'Defined contribution', db: 'Defined benefit', state: 'State Pension forecast' };

function Amount({ value, label, suffix = '' }: { value: PensionAmountSummary; label: string; suffix?: string }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography sx={{ mt: 0.75, fontSize: { xs: 24, sm: 28 }, fontWeight: 600, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.035em', overflowWrap: 'anywhere' }}>{value.knownTotal === null ? 'Unknown' : formatCurrency(value.knownTotal)}{value.knownTotal !== null && suffix && <Typography component="span" sx={{ display: 'inline-block', whiteSpace: 'nowrap', ml: 0.5, fontSize: 12, fontWeight: 400, letterSpacing: 0, color: 'text.secondary' }}>{suffix}</Typography>}</Typography>
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }}>{value.knownCount} recorded · {value.unknownCount} unknown{value.unknownCount > 0 && value.knownCount > 0 ? ' · partial total' : ''}</Typography>
  </Box>;
}

function moneyOrUnknown(value: string | null): string { return value === null ? 'Unknown' : formatCurrency(value); }

export default function PensionRecordsWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<WorkspaceData>('/api/pension-records', fetchJson, { shouldRetryOnError: false });
  const [scope, setScope] = useState('');
  const [editor, setEditor] = useState<{ original: PensionRecord | null; draft: PensionRecordDraft } | null>(null);
  const [removing, setRemoving] = useState<PensionRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [success, setSuccess] = useState('');
  const records = data?.workspace.data ?? [];
  const accounts = data?.pensionAccounts ?? [];
  const selectedOwnerId = scope === '' ? null : Number(scope);
  const summary = summarizePensionRecords(records, accounts, selectedOwnerId);
  const visibleRecords = selectedOwnerId === null ? records : records.filter(record => pensionRecordOwnerId(record, accounts) === selectedOwnerId);

  const openEditor = (record: PensionRecord | null) => {
    setSaveError(''); setConflict(false);
    setEditor({ original: record, draft: pensionRecordDraft(record, crypto.randomUUID()) });
  };
  const change = (key: keyof PensionRecordDraft, value: string) => {
    if (!editor || busy) return;
    const draft = { ...editor.draft, [key]: value };
    if (key === 'linkedAccountId') {
      const account = accounts.find(item => String(item.id) === value);
      if (account) { draft.ownerId = account.ownerId?.toString() ?? ''; draft.potAmount = ''; }
    }
    setEditor({ ...editor, draft });
  };

  const persist = async (nextRecords: PensionRecord[], message: string) => {
    if (!data || pending.current || conflict) return;
    const checked = pensionRecordsDataSchema.safeParse(nextRecords);
    if (!checked.success) { setSaveError(checked.error.issues.map(issue => issue.message).join('; ')); return; }
    pending.current = true; setBusy(true); setSaveError('');
    try {
      const response = await fetch('/api/pension-records', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: checked.data, revision: data.workspace.revision }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        if (response.status === 409) setConflict(true);
        throw new Error(result?.error ?? `Saving failed (${response.status}). Please try again.`);
      }
      if (!result?.workspace) throw new Error('The server did not confirm the saved inventory. Reload before trying again.');
      await mutate(result as WorkspaceData, { revalidate: false });
      setEditor(null); setRemoving(null); setSuccess(message);
    } catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'The inventory could not be saved.'); }
    finally { pending.current = false; setBusy(false); }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!editor) return;
    const parsed = pensionRecordSchema.safeParse(pensionRecordFromDraft(editor.draft));
    if (!parsed.success) { setSaveError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
    const next = editor.original ? records.map(record => record.id === editor.original!.id ? parsed.data : record) : [...records, parsed.data];
    void persist(next, editor.original ? 'Pension record updated.' : 'Pension record added.');
  };

  const reloadConflict = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true);
    try {
      const latest = await fetchJson<WorkspaceData>('/api/pension-records');
      await mutate(latest, { revalidate: false });
      setEditor(null); setRemoving(null); setConflict(false); setSaveError('');
      setSuccess('Latest records loaded. Reopen the scheme to make your changes.');
    } catch (failure) { setSaveError(failure instanceof Error ? failure.message : 'The latest inventory could not be loaded.'); }
    finally { pending.current = false; setBusy(false); }
  };

  const errorNotice = saveError ? <Alert severity="error" sx={{ mt: 2 }}>{saveError}{conflict && <Box sx={{ mt: 1 }}>Another change was saved first. Reload to review it before editing again. <Button size="small" onClick={() => void reloadConflict()} disabled={busy}>Reload records</Button></Box>}</Alert> : null;
  const field = (key: keyof PensionRecordDraft, label: string, options: { money?: boolean; date?: boolean; helperText?: string } = {}) => <TextField
    label={label} value={editor?.draft[key] ?? ''} onChange={event => change(key, event.target.value)} fullWidth disabled={busy}
    type={options.date ? 'date' : 'text'} slotProps={{ inputLabel: options.date ? { shrink: true } : undefined, htmlInput: options.money ? { inputMode: 'decimal' } : options.date ? { max: londonTodayIso() } : undefined }}
    helperText={options.helperText ?? 'Leave blank if unknown.'}
  />;
  const currentLink = editor?.draft.linkedAccountId ? accounts.find(account => String(account.id) === editor.draft.linkedAccountId) : null;

  return <Box>
    <PageHeader
      title="Pension records"
      description="Your pension pots, scheme benefits and State Pension forecasts, organised by owner."
      actions={<Button variant="contained" startIcon={<AddRoundedIcon />} disabled={Boolean(error || isLoading || busy)} onClick={() => openEditor(null)}>Add pension record</Button>}
    />
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mb: 3 }}>
      <Button component={Link} href="/pensions" variant="outlined" endIcon={<ArrowForwardRoundedIcon />}>Retirement calculator</Button>
      <Button component={Link} href="/investments">Ledger pension accounts</Button>
      <Button component={Link} href="https://www.gov.uk/check-state-pension" target="_blank" rel="noopener noreferrer">Official State Pension forecast</Button>
    </Stack>

    {isLoading ? <Skeleton variant="rounded" height={200} /> : error ? <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your pension inventory and ledger balances are unavailable. Retry when the database connection is restored. No missing figures have been replaced with zero.</Alert> : data && <>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} sx={{ mb: 2 }}>
        <TextField select label="View pension records for" value={scope} onChange={event => setScope(event.target.value)} size="small" slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }} sx={{ width: { xs: '100%', sm: 320 } }}>
          <MenuItem value="">Household · all recorded schemes</MenuItem>{data.owners.map(owner => <MenuItem key={owner.id} value={String(owner.id)}>{owner.name}</MenuItem>)}
        </TextField>
        <Typography variant="body2" color="text.secondary">{visibleRecords.length} {visibleRecords.length === 1 ? 'record' : 'records'} · {summary.scope === 'household' ? 'Household view' : 'Personal view'}</Typography>
      </Stack>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2, mb: 2 }}>
        <Card sx={{ gridColumn: { xs: '1 / -1', md: 'auto' } }}><CardContent><Amount value={summary.dc.pot} label={`${summary.scope === 'household' ? 'Household' : 'Personal'} DC pots · known values`} /><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{summary.dc.linkedAccountCount} linked ledger {summary.dc.linkedAccountCount === 1 ? 'account' : 'accounts'}</Typography></CardContent></Card>
        <Card><CardContent><Amount value={summary.db.annualIncome} label="DB annual income" suffix="/ year" /><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>Promised at each scheme&apos;s recorded start age.</Typography></CardContent></Card>
        <Card><CardContent><Amount value={summary.state.annualForecast} label="State Pension forecasts" suffix="/ year" /><Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>{summary.scope === 'household' ? 'Combined known forecasts for recorded people.' : 'Your entered official forecast.'}</Typography></CardContent></Card>
      </Box>
      <Alert severity="info" sx={{ mb: 3 }}>These records describe your existing benefits and do not add money to your ledger or net worth. DB promises and State Pension forecasts are annual income; neither is converted into a guessed pot value.</Alert>
      {summary.warnings.map(warning => <Alert key={warning} severity="warning" sx={{ mb: 2 }}>{warning}</Alert>)}
      <Card sx={{ mb: 3 }}><CardContent>
        <Typography variant="h6">Monthly DC contributions</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>Gross amounts credited to your pension pots.</Typography>
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, minmax(0, 1fr))', md: 'repeat(3, minmax(0, 1fr))' }, gap: { xs: 2, md: 3 }, mt: 2.5 }}>
          <Amount value={summary.dc.personalMonthlyContributions} label="Personal" />
          <Amount value={summary.dc.employerMonthlyContributions} label="Employer" />
          <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, borderTop: { xs: '1px solid', md: 'none' }, borderColor: 'divider', pt: { xs: 2, md: 0 } }}><Amount value={summary.dc.totalMonthlyContributions} label="Combined · both amounts known" /></Box>
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>Include relief already credited. No tax relief or employer match is added automatically. An explicit zero is different from an unknown amount.</Typography>
      </CardContent></Card>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}><Typography variant="h6">Recorded schemes</Typography><Typography variant="caption" color="text.secondary">{visibleRecords.length} {visibleRecords.length === 1 ? 'scheme' : 'schemes'}</Typography></Stack>
      {visibleRecords.length === 0 ? <Card><CardContent sx={{ textAlign: 'center', py: 5 }}><Typography variant="h6">{records.length === 0 ? 'Start with your latest pension statement' : 'No schemes recorded for this person'}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2, maxWidth: 440, mx: 'auto' }}>Use your latest statement or official forecast. Assign its owner and leave unconfirmed figures blank.</Typography><Button variant="outlined" onClick={() => openEditor(null)} startIcon={<AddRoundedIcon />}>Add pension record</Button></CardContent></Card> : <Card>
        {visibleRecords.map((record, index) => {
          const owner = data.owners.find(item => item.id === pensionRecordOwnerId(record, accounts));
          const account = record.type === 'dc' ? accounts.find(item => item.id === record.linkedAccountId) : undefined;
          return <Box key={record.id} component="article" aria-label={record.name} sx={{ p: { xs: 2, sm: 3 }, borderTop: index > 0 ? '1px solid' : undefined, borderColor: 'divider' }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1.5}>
              <Box sx={{ minWidth: 0 }}><Typography variant="subtitle1" component="h2" fontWeight={600} sx={{ overflowWrap: 'anywhere' }}>{record.name}</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.25, overflowWrap: 'anywhere' }}>{record.provider ?? 'Provider unknown'} · {owner?.name ?? 'Ownership unknown'}</Typography></Box>
              <Chip label={typeNames[record.type]} size="small" variant="outlined" sx={{ alignSelf: 'flex-start', maxWidth: '100%', flexShrink: 0 }} />
            </Stack>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 1fr) minmax(0, 1fr)' }, gap: 2, mt: 2 }}>
              {record.type === 'dc' ? <>
                <Box><Typography variant="caption" color="text.secondary">{record.linkedAccountId !== null ? 'Current linked ledger pot' : 'Recorded statement pot'}</Typography><Typography sx={{ mt: 0.5, fontSize: 28, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{moneyOrUnknown(pensionRecordPot(record, accounts))}</Typography><Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75, overflowWrap: 'anywhere' }}>{record.linkedAccountId !== null ? account ? `${account.name} · ledger as of ${account.balanceAsOf}` : 'Linked account unavailable' : record.statementAsOf ? `Statement as of ${record.statementAsOf}` : 'Statement date unknown'}</Typography></Box>
                <Stack gap={0.75}><RecordDetail label="Personal monthly contribution" value={moneyOrUnknown(record.personalMonthlyContribution)} /><RecordDetail label="Employer monthly contribution" value={moneyOrUnknown(record.employerMonthlyContribution)} /><RecordDetail label="Annual fee rate" value={record.annualFeeRate === null ? 'Unknown' : `${record.annualFeeRate}%`} /></Stack>
              </> : <>
                <Box><Typography variant="caption" color="text.secondary">{record.type === 'db' ? 'Promised annual income' : 'Entered official forecast · annual income'}</Typography><Typography sx={{ mt: 0.5, fontSize: 28, fontWeight: 600, lineHeight: 1.25, letterSpacing: '-0.035em', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{moneyOrUnknown(record.type === 'db' ? record.promisedAnnualIncome : record.forecastAnnualIncome)}</Typography></Box>
                <Stack gap={0.75}><RecordDetail label="Recorded start age" value={String(record.startAge ?? 'Unknown')} /><RecordDetail label={record.type === 'state' ? 'Forecast source date' : 'Statement date'} value={record.type === 'state' ? record.forecastSourceDate ?? 'Unknown' : record.statementAsOf ?? 'Unknown'} /></Stack>
              </>}
            </Box>
            {record.notes && <Box sx={{ mt: 2, pl: 1.5, borderLeft: '2px solid', borderColor: 'divider' }}><Typography variant="caption" color="text.secondary">Source notes and conditions</Typography><Typography variant="body2" sx={{ mt: 0.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.notes}</Typography></Box>}
            <Stack direction="row" gap={1} sx={{ mt: 2 }}><Button size="small" startIcon={<EditRoundedIcon />} aria-label={`Edit ${record.name}`} disabled={busy} onClick={() => openEditor(record)}>Edit record</Button><Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} aria-label={`Remove ${record.name}`} disabled={busy} onClick={() => { setSaveError(''); setConflict(false); setRemoving(record); }}>Remove</Button></Stack>
          </Box>;
        })}
      </Card>}
      <Alert severity="info" sx={{ mt: 3 }}>To use these figures in the retirement calculator, choose the relevant person&apos;s DC pots and enter their contributions and forecast explicitly. The calculator projects DC accumulation and compares initial withdrawal-rate income; it does not model drawdown longevity. DB promised income is recorded here and is not included in that calculation. Existing saved scenarios are preserved.</Alert>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>{summary.methodology}</Typography>
    </>}

    <Dialog open={Boolean(editor)} onClose={() => { if (!busy) setEditor(null); }} fullWidth maxWidth="sm"><Box component="form" onSubmit={save}><DialogTitle>{editor?.original ? 'Edit pension record' : 'Add pension record'}</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
      <TextField select fullWidth label="Pension type" value={editor?.draft.type ?? 'dc'} disabled={busy} onChange={event => change('type', event.target.value)}>{Object.entries(typeNames).map(([type, name]) => <MenuItem key={type} value={type}>{name}</MenuItem>)}</TextField>
      {field('name', 'Scheme name', { helperText: 'Use the name on your statement.' })}{field('provider', 'Provider or scheme administrator')}
      <TextField select fullWidth label="Owner" value={editor?.draft.ownerId ?? ''} disabled={busy || Boolean(editor?.draft.type === 'dc' && editor.draft.linkedAccountId)} onChange={event => change('ownerId', event.target.value)} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }} helperText={editor?.draft.type === 'dc' && editor.draft.linkedAccountId ? 'Ownership comes from the linked ledger account.' : 'Assign the person whose pension or forecast this is.'}><MenuItem value="">Unknown ownership</MenuItem>{data?.owners.map(owner => <MenuItem key={owner.id} value={String(owner.id)}>{owner.name}</MenuItem>)}</TextField>
      {editor?.draft.type === 'dc' && <>
        <TextField select fullWidth label="DC pot source" value={editor.draft.linkedAccountId} disabled={busy} onChange={event => change('linkedAccountId', event.target.value)} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }} helperText="Link one ledger account once. Only ASSET investment accounts tagged pension are available."><MenuItem value="">Enter a statement value · no ledger link</MenuItem>{accounts.map(account => <MenuItem key={account.id} value={String(account.id)} disabled={records.some(record => record.type === 'dc' && record.id !== editor.draft.id && record.linkedAccountId === account.id)}>{account.name} · {account.ownerName ?? 'owner unknown'}</MenuItem>)}</TextField>
        {editor.draft.linkedAccountId ? <Alert severity="info">{currentLink ? `The ledger's current ${formatCurrency(currentLink.balance)} balance is used as of ${currentLink.balanceAsOf}.` : 'This linked account is unavailable. Select another account or record a statement value.'} Saving this descriptive record does not change that balance.</Alert> : field('potAmount', 'DC statement pot (£)', { money: true })}
        {field('personalMonthlyContribution', 'Personal gross monthly contribution (£)', { money: true, helperText: 'Gross amount credited to the pot. Enter 0 only if confirmed; leave blank if unknown.' })}{field('employerMonthlyContribution', 'Employer monthly contribution (£)', { money: true })}{field('annualFeeRate', 'Annual fee rate (%)', { money: true, helperText: 'Use the stated annual percentage. No fee estimate is inferred.' })}
      </>}
      {editor?.draft.type === 'db' && <>{field('promisedAnnualIncome', 'DB promised annual income (£)', { money: true, helperText: 'Annual pension promised at the recorded start age. This is income, not a pot.' })}{field('startAge', 'DB income start age', { helperText: 'Use the age stated by your scheme; leave blank if unknown.' })}</>}
      {editor?.draft.type === 'state' && <>{field('forecastAnnualIncome', 'Official forecast annual income (£)', { money: true, helperText: 'Copy your own official forecast. Check whether it depends on future qualifying years.' })}{field('forecastSourceDate', 'Official forecast source date', { date: true })}{field('startAge', 'Forecast payment start age', { helperText: 'Use your official forecast age; no statutory age is assumed.' })}<Alert severity="info">Your forecast may change. Record any qualifying-year conditions in the notes. No full State Pension entitlement is assumed.</Alert></>}
      {field('statementAsOf', 'Statement date', { date: true })}<TextField multiline minRows={2} label="Source notes and conditions" value={editor?.draft.notes ?? ''} fullWidth disabled={busy} onChange={event => change('notes', event.target.value)} helperText="For example: benefit start date, forecast conditions, statement source or contact details." />
      {errorNotice}
    </Stack></DialogContent><DialogActions sx={{ px: 3, pb: 2 }}><Button disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button variant="contained" type="submit" disabled={busy || conflict}>{busy ? 'Saving…' : 'Save pension record'}</Button></DialogActions></Box></Dialog>
    <Dialog open={Boolean(removing)} onClose={() => { if (!busy) setRemoving(null); }} fullWidth maxWidth="xs"><DialogTitle>Remove pension record?</DialogTitle><DialogContent><Typography variant="body2">Remove {removing?.name} from your inventory? Its ledger account, balances and saved retirement scenario are preserved.</Typography>{errorNotice}</DialogContent><DialogActions><Button disabled={busy} onClick={() => setRemoving(null)}>Cancel</Button><Button color="error" disabled={busy || conflict} onClick={() => void persist(records.filter(record => record.id !== removing?.id), 'Pension record removed.')}>{busy ? 'Removing…' : 'Remove record'}</Button></DialogActions></Dialog>
    <Snackbar open={Boolean(success)} autoHideDuration={5000} onClose={() => setSuccess('')} message={success} />
  </Box>;
}

function RecordDetail({ label, value }: { label: string; value: string }) {
  return <Stack direction="row" justifyContent="space-between" gap={2}><Typography variant="body2" color="text.secondary" sx={{ minWidth: 0 }}>{label}</Typography><Typography variant="body2" fontWeight={500} sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{value}</Typography></Stack>;
}
