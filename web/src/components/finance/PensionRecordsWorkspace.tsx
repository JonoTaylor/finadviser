'use client';

import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { Alert, Box, Button, Card, CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider, MenuItem, Skeleton, Snackbar, Stack, TextField, Typography } from '@mui/material';
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
import { serifFamily, softTokens } from '@/theme/theme';

const typeNames: Record<PensionRecordType, string> = { dc: 'Defined contribution', db: 'Defined benefit', state: 'State Pension forecast' };

function Amount({ value, label, suffix = '' }: { value: PensionAmountSummary; label: string; suffix?: string }) {
  return <Box sx={{ minWidth: 0 }}>
    <Typography variant="caption">{label}</Typography>
    <Typography variant="h4" sx={{ mt: 1, fontFamily: serifFamily, overflowWrap: 'anywhere' }}>{value.knownTotal === null ? 'Unknown' : `${formatCurrency(value.knownTotal)}${suffix}`}</Typography>
    <Typography variant="caption">{value.knownCount} recorded · {value.unknownCount} unknown{value.unknownCount > 0 && value.knownCount > 0 ? ' · partial total' : ''}</Typography>
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

  return <Box sx={{ pt: { xs: 4, md: 0 } }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'flex-start', sm: 'center' }} gap={2} sx={{ mb: 3 }}>
      <Box><Typography variant="overline" sx={{ letterSpacing: '0.14em', color: softTokens.mint.ink }}>Know what you already have</Typography><Typography variant="h4" component="h1">Pension records</Typography><Typography variant="body2" sx={{ mt: 1, maxWidth: 680 }}>Bring together pension pots, scheme promises and your official State Pension forecast. Keep each person&apos;s benefits separate and use your own records to fill the gaps.</Typography></Box>
      <Button variant="contained" startIcon={<AddRoundedIcon />} disabled={Boolean(error || isLoading || busy)} onClick={() => openEditor(null)} sx={{ flexShrink: 0 }}>Add pension record</Button>
    </Stack>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} sx={{ mb: 3 }}><Button component={Link} href="/pensions" endIcon={<ArrowForwardRoundedIcon />}>Explore a retirement scenario</Button><Button component={Link} href="/investments">Manage ledger pension accounts</Button><Button component={Link} href="https://www.gov.uk/check-state-pension" target="_blank" rel="noopener noreferrer">Check your official State Pension forecast</Button></Stack>
    <Alert severity="info" sx={{ mb: 3 }}>These records describe your existing benefits. They do not add money to your ledger or net worth. A defined benefit promise is annual income, and a State Pension forecast is your recorded forecast; neither is converted into a guessed pot value.</Alert>

    {isLoading ? <Skeleton variant="rounded" height={200} /> : error ? <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your pension inventory and ledger balances are unavailable. Retry when the database connection is restored. No missing figures have been replaced with zero.</Alert> : data && <>
      <TextField select label="View pension records for" value={scope} onChange={event => setScope(event.target.value)} slotProps={{ inputLabel: { shrink: true }, select: { displayEmpty: true } }} sx={{ width: { xs: '100%', sm: 320 }, mb: 3 }}>
        <MenuItem value="">Household · all recorded schemes</MenuItem>{data.owners.map(owner => <MenuItem key={owner.id} value={String(owner.id)}>{owner.name}</MenuItem>)}
      </TextField>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' }, gap: 2, mb: 3 }}>
        <Card sx={{ bgcolor: softTokens.cream }}><CardContent><Amount value={summary.dc.pot} label={`${summary.scope === 'household' ? 'Household' : 'Personal'} DC pots · known values`} /><Typography variant="caption" sx={{ mt: 1, display: 'block' }}>{summary.dc.linkedAccountCount} linked ledger {summary.dc.linkedAccountCount === 1 ? 'account' : 'accounts'}</Typography></CardContent></Card>
        <Card><CardContent><Amount value={summary.db.annualIncome} label="DB promised annual income" suffix=" / year" /><Typography variant="caption" sx={{ mt: 1, display: 'block' }}>At each scheme&apos;s recorded start age.</Typography></CardContent></Card>
        <Card><CardContent><Amount value={summary.state.annualForecast} label="Recorded State Pension forecasts" suffix=" / year" /><Typography variant="caption" sx={{ mt: 1, display: 'block' }}>{summary.scope === 'household' ? 'Combined known forecasts for recorded people.' : 'Your entered official forecast.'}</Typography></CardContent></Card>
      </Box>
      {summary.warnings.map(warning => <Alert key={warning} severity="warning" sx={{ mb: 2 }}>{warning}</Alert>)}
      <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6">Gross monthly contributions into DC pots</Typography><Stack direction={{ xs: 'column', md: 'row' }} gap={3} sx={{ mt: 2 }}><Box sx={{ flex: 1 }}><Amount value={summary.dc.personalMonthlyContributions} label="Personal · gross credited amount" /></Box><Box sx={{ flex: 1 }}><Amount value={summary.dc.employerMonthlyContributions} label="Employer · credited amount" /></Box><Box sx={{ flex: 1 }}><Amount value={summary.dc.totalMonthlyContributions} label="Combined · schemes with both amounts known" /></Box></Stack><Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Enter the gross amount credited to the pension, including any relief already credited. No tax relief or employer match is added automatically. An explicit zero is different from an unknown amount.</Typography></CardContent></Card>
      {visibleRecords.length === 0 ? <Card><CardContent sx={{ textAlign: 'center', py: 5 }}><Typography variant="h6">{records.length === 0 ? 'Start with your latest pension statement' : 'No schemes recorded for this person'}</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>Add a pot or scheme promise, assign its owner, and leave any unconfirmed figure blank.</Typography><Button variant="outlined" onClick={() => openEditor(null)} startIcon={<AddRoundedIcon />}>Add pension record</Button></CardContent></Card> : <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 3 }}>
        {visibleRecords.map(record => {
          const owner = data.owners.find(item => item.id === pensionRecordOwnerId(record, accounts));
          const account = record.type === 'dc' ? accounts.find(item => item.id === record.linkedAccountId) : undefined;
          return <Card key={record.id} component="article" aria-label={record.name}><CardContent>
            <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={1}><Box sx={{ minWidth: 0 }}><Typography variant="h6" component="h2" sx={{ overflowWrap: 'anywhere' }}>{record.name}</Typography><Typography variant="caption">{record.provider ?? 'Provider unknown'} · {owner?.name ?? 'Ownership unknown'}</Typography></Box><Chip label={typeNames[record.type]} size="small" sx={{ alignSelf: 'flex-start', maxWidth: '100%' }} /></Stack>
            <Divider sx={{ my: 2 }} />
            {record.type === 'dc' ? <>
              <Typography variant="caption">{record.linkedAccountId !== null ? 'Current linked ledger pot' : 'Recorded statement pot'}</Typography><Typography variant="h4" sx={{ mt: 0.5, fontFamily: serifFamily, overflowWrap: 'anywhere' }}>{moneyOrUnknown(pensionRecordPot(record, accounts))}</Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{record.linkedAccountId !== null ? account ? `${account.name} · ledger as of ${account.balanceAsOf}` : 'Linked account unavailable' : record.statementAsOf ? `Statement as of ${record.statementAsOf}` : 'Statement date unknown'}</Typography>
              <Typography variant="body2" sx={{ mt: 2 }}>Monthly personal {moneyOrUnknown(record.personalMonthlyContribution)} · employer {moneyOrUnknown(record.employerMonthlyContribution)}</Typography><Typography variant="body2" sx={{ mt: 0.5 }}>Annual fee rate: {record.annualFeeRate === null ? 'Unknown' : `${record.annualFeeRate}%`}</Typography>
            </> : <>
              <Typography variant="caption">{record.type === 'db' ? 'Promised annual income' : 'Entered official forecast · annual income'}</Typography><Typography variant="h4" sx={{ mt: 0.5, fontFamily: serifFamily, overflowWrap: 'anywhere' }}>{moneyOrUnknown(record.type === 'db' ? record.promisedAnnualIncome : record.forecastAnnualIncome)}</Typography><Typography variant="body2" sx={{ mt: 1 }}>Recorded start age: {record.startAge ?? 'Unknown'}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{record.type === 'state' ? `Forecast source date: ${record.forecastSourceDate ?? 'Unknown'}` : `Statement as of ${record.statementAsOf ?? 'Unknown'}`}</Typography>
            </>}
            {record.notes && <Typography variant="body2" sx={{ mt: 2, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{record.notes}</Typography>}
            <Stack direction="row" gap={1} sx={{ mt: 3 }}><Button size="small" startIcon={<EditRoundedIcon />} aria-label={`Edit ${record.name}`} disabled={busy} onClick={() => openEditor(record)}>Edit record</Button><Button size="small" color="error" startIcon={<DeleteOutlineRoundedIcon />} aria-label={`Remove ${record.name}`} disabled={busy} onClick={() => { setSaveError(''); setConflict(false); setRemoving(record); }}>Remove</Button></Stack>
          </CardContent></Card>;
        })}
      </Box>}
      <Alert severity="info" sx={{ mt: 3 }}>To use these figures in the retirement calculator, choose the relevant person&apos;s DC pots and enter their contributions and forecast explicitly. The calculator projects DC accumulation and compares initial withdrawal-rate income; it does not model drawdown longevity. DB promised income is recorded here and is not included in that calculation. Existing saved scenarios are preserved.</Alert>
      <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>{summary.methodology}</Typography>
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
