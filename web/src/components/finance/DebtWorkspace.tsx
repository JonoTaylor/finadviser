'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import Link from 'next/link';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card, CardContent,
  Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControlLabel,
  MenuItem, Skeleton, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  TextField, Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import { londonTodayIso } from '@/lib/dates/today';
import { formatCurrency } from '@/lib/utils/formatting';
import { debtRecordSchema, type DebtRecord, type DebtWorkspaceResponse, type ResolvedDebt } from '@/lib/debts/types';
import { compareDebtRepayment, type DebtRepaymentResult } from '@/lib/debts/repayment';

const initialDebt = (): DebtRecord => ({
  id: crypto.randomUUID(), name: '', accountId: null, ownerId: null, statementBalance: null,
  statementAsOf: londonTodayIso(), apr: null, minimumPayment: null, priority: false,
  inArrears: false, promotionalApr: null, promotionalExpiresOn: null, paymentRestrictions: '', feeNotes: '',
});
const asLocalDebt = (debt: DebtRecord): ResolvedDebt => ({
  ...debt, effectiveBalance: debt.statementBalance, balanceAsOf: debt.statementAsOf,
  balanceSource: 'statement', accountName: null, sourceWarning: 'Temporary calculator entry; not saved to your account',
});
const dateLabel = (iso: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));
const statusText: Record<DebtRepaymentResult['status'], string> = {
  paid_off: 'Illustrated payoff', incomplete: 'More details needed', attention_required: 'Resolve arrears first',
  insufficient_budget: 'Budget below minimums', negative_amortization: 'Debt does not fall', timeline_limit: 'Beyond the timeline limit',
};

function ResultCard({ result }: { result: DebtRepaymentResult }) {
  return <Card sx={{ flex: 1, minWidth: 0 }}><CardContent>
    <Typography variant="h6" component="h3">{result.strategy === 'avalanche' ? 'Highest APR first' : 'Smallest balance first'}</Typography>
    <Typography variant="body2" sx={{ mt: 0.5, mb: 1.5 }}>{result.strategy === 'avalanche' ? 'Avalanche: target expensive borrowing after minimums.' : 'Snowball: clear smaller balances after minimums.'}</Typography>
    <Chip size="small" label={statusText[result.status]} color={result.status === 'paid_off' ? 'success' : 'warning'} sx={{ mb: 2 }} />
    {result.status === 'paid_off' ? <>
      <Typography sx={{ fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{result.months === 0 ? 'No balance owed' : `${result.months} months`}</Typography>
      <Typography variant="body2" sx={{ mt: 0.5 }}>{result.months ? `Illustrated final payment: ${dateLabel(result.payoffDate!)}` : 'Across the debts entered here'}</Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2, mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}><Box sx={{ minWidth: 0 }}><Typography variant="caption">Illustrated interest</Typography><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{formatCurrency(result.totalInterest!)}</Typography></Box><Box sx={{ minWidth: 0 }}><Typography variant="caption">Total payments</Typography><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{formatCurrency(result.totalPaid!)}</Typography></Box></Box>
    </> : <Typography variant="body2">
      {result.status === 'incomplete' ? 'Enter the missing terms and review any restrictions or fees to calculate a timeline.' : result.status === 'attention_required' ? 'An accelerated payoff illustration cannot account for an arrears agreement. Contact your creditor or free debt advice first.' : result.status === 'insufficient_budget' ? `At least ${formatCurrency(result.requiredMinimum!)} is needed for the recorded minimums. Review affordability and speak to creditors.` : result.status === 'negative_amortization' ? 'No debt balance fell in the final year of this 50-year illustration. No payoff was reached within that horizon.' : 'Debt remains after 50 years of these assumptions. No payoff date is shown.'}
    </Typography>}
  </CardContent></Card>;
}

export default function DebtWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<DebtWorkspaceResponse>('/api/debts', fetchJson, { shouldRetryOnError: false });
  const [localDebts, setLocalDebts] = useState<DebtRecord[]>([]);
  const [editor, setEditor] = useState<DebtRecord | null>(null);
  const [editorError, setEditorError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const writing = useRef(false);
  const [monthlyBudget, setMonthlyBudget] = useState('');
  const [strategy, setStrategy] = useState<'avalanche' | 'snowball'>('avalanche');
  const [remove, setRemove] = useState<DebtRecord | null>(null);
  const [conflict, setConflict] = useState(false);
  const [conflictRevision, setConflictRevision] = useState<number | null>(null);
  const temporary = Boolean(error);
  const debts = temporary ? localDebts.map(asLocalDebt) : data?.debts ?? [];
  const savedDebt = editor && (temporary ? localDebts : data?.workspace.data.debts ?? []).some(debt => debt.id === editor.id);
  const total = debts.reduce((sum, debt) => sum.plus(debt.effectiveBalance ?? '0'), new Decimal(0));
  const budgetValid = /^\d+(\.\d{1,2})?$/.test(monthlyBudget) && new Decimal(monthlyBudget).lt('1000000000000');
  const comparisons = debts.length && budgetValid ? compareDebtRepayment({ debts, monthlyBudget, asOf: data?.asOf ?? londonTodayIso() }) : null;
  const result = comparisons?.[strategy];
  const missing = comparisons?.avalanche.missingInputs ?? [];
  const warnings = comparisons?.avalanche.warnings ?? [];

  useEffect(() => {
    if (conflict && data && conflictRevision !== null && data.workspace.revision !== conflictRevision) setConflict(false);
  }, [conflict, conflictRevision, data]);

  async function persist(next: DebtRecord[]) {
    if (!data) throw new Error('Saved debts are unavailable. Retry the connection before saving.');
    const response = await fetch('/api/debts', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { debts: next }, revision: data.workspace.revision }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      if (response.status === 409) {
        setConflict(true);
        setConflictRevision(data.workspace.revision);
      }
      throw new Error(typeof body?.error === 'string' ? body.error : 'Debt details could not be saved. Your entries are still here.');
    }
    if (!body) throw new Error('The saved response could not be read. Reload before trying again.');
    await mutate(body as DebtWorkspaceResponse, { revalidate: false });
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor || writing.current || conflict) return;
    const parsed = debtRecordSchema.safeParse(editor);
    if (!parsed.success) { setEditorError(parsed.error.issues.map(issue => issue.message).join('; ')); return; }
    if (parsed.data.statementAsOf && parsed.data.statementAsOf > londonTodayIso()) { setEditorError('A statement date cannot be in the future.'); return; }
    const existing = temporary ? localDebts : data?.workspace.data.debts ?? [];
    if (parsed.data.accountId !== null && existing.some(debt => debt.id !== parsed.data.id && debt.accountId === parsed.data.accountId)) { setEditorError('This liability account is already linked to another debt.'); return; }
    const next = savedDebt ? existing.map(debt => debt.id === parsed.data.id ? parsed.data : debt) : [...existing, parsed.data];
    writing.current = true; setBusy(true); setEditorError('');
    try {
      if (temporary) setLocalDebts(next); else await persist(next);
      setEditor(null); setNotice(temporary ? 'Temporary calculator entry added. It is not saved.' : 'Debt details saved. Your ledger balance has not changed.');
    } catch (saveError) { setEditorError(saveError instanceof Error ? saveError.message : 'Could not save debt details.'); }
    finally { writing.current = false; setBusy(false); }
  }

  async function removeDebt() {
    if (!remove || writing.current || conflict) return;
    const next = (temporary ? localDebts : data?.workspace.data.debts ?? []).filter(debt => debt.id !== remove.id);
    writing.current = true; setBusy(true); setEditorError('');
    try {
      if (temporary) setLocalDebts(next); else await persist(next);
      setRemove(null); setNotice('Debt details removed from this workspace. No ledger entries were deleted.');
    } catch (saveError) { setEditorError(saveError instanceof Error ? saveError.message : 'Could not remove debt details.'); }
    finally { writing.current = false; setBusy(false); }
  }

  const patch = (value: Partial<DebtRecord>) => setEditor(current => current ? { ...current, ...value } : current);
  return <Box>
    <PageHeader title="Debt control" description="Track repayment terms, protect essential bills and compare affordable repayment approaches." actions={<Button variant="contained" startIcon={<AddRoundedIcon />} disabled={isLoading || busy} onClick={() => { setEditor(initialDebt()); setEditorError(''); }}>{temporary ? 'Add calculator debt' : 'Add debt details'}</Button>} />
    {isLoading && <Skeleton variant="rounded" height={160} sx={{ mb: 3 }} />}
    {error && <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>} sx={{ mb: 3 }}>Saved debt details could not be loaded. You can use temporary calculator entries below; they disappear when you leave or reload. Saving requires the database connection.</Alert>}
    {notice && <Alert severity="success" onClose={() => setNotice('')} sx={{ mb: 3 }}>{notice}</Alert>}
    {debts.some(debt => debt.priority || debt.inArrears) && <Alert severity="warning" sx={{ mb: 3 }}>Protect essential costs and priority repayments first. {debts.some(debt => debt.inArrears) ? 'Arrears need an agreed plan before accelerated repayments.' : 'Both illustrations put extra payments towards priority debts before other borrowing.'} <Link href="https://www.moneyhelper.org.uk/en/money-troubles/dealing-with-debt/debt-advice-locator" target="_blank" rel="noopener noreferrer">Find free debt advice</Link>.</Alert>}

    {!isLoading && <>
      <Card sx={{ mb: 3 }}><CardContent>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 2 }}><Box sx={{ minWidth: 0 }}><Typography variant="caption">Owed across {temporary ? 'temporary entries' : 'debts entered here'}</Typography><Typography sx={{ fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 600, mt: 0.5, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{debts.length ? formatCurrency(total) : '—'}</Typography></Box><Box sx={{ minWidth: 0 }}><Typography variant="caption">Recorded debts</Typography><Typography sx={{ fontSize: '1.75rem', lineHeight: 1.25, fontWeight: 600, mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{debts.length}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>{data?.asOf ? `Ledger date ${dateLabel(data.asOf)}` : 'Temporary calculator only'}</Typography></Box></Box>
        <Box sx={{ mt: 2, pt: 2, borderTop: 1, borderColor: 'divider' }}><Typography variant="body2">Linked accounts use today&apos;s signed liability ledger balance. Standalone debts use your dated statement. This workspace adds repayment details; it does not add debt to your net worth or make payments.</Typography>{debts.some(debt => debt.effectiveBalance === null) && <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>Some linked balances are unavailable; the total is partial.</Typography>}</Box>
        {debts.length === 0 ? <Box sx={{ py: 3 }}><Typography variant="h6">Start with a statement or existing liability account</Typography><Typography variant="body2" sx={{ mt: 1 }}>Record the APR and minimum repayment exactly as shown. Leave anything unknown blank so the plan can show what needs checking.</Typography></Box> : <Stack sx={{ mt: 2 }}>{debts.map(debt => <Box key={debt.id} component="article" aria-label={debt.name} sx={{ py: 2.5, borderTop: 1, borderColor: 'divider' }}>
          <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}><Box sx={{ minWidth: 0 }}><Typography variant="subtitle1" component="h2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{debt.name}</Typography><Typography variant="caption">{debt.balanceSource === 'ledger' ? `Linked: ${debt.accountName}` : debt.balanceSource === 'statement' ? 'Statement balance' : 'Linked balance unavailable'}{debt.balanceAsOf ? ` · ${dateLabel(debt.balanceAsOf)}` : ''}</Typography><Stack direction="row" flexWrap="wrap" gap={1} sx={{ mt: 1 }}>{debt.priority && <Chip label="Priority debt" size="small" color="warning" />}{debt.inArrears && <Chip label="Arrears" size="small" color="error" />}{debt.promotionalApr !== null && <Chip size="small" label={`${debt.promotionalApr}% until ${debt.promotionalExpiresOn}`} />}</Stack></Box><Box sx={{ minWidth: 0, textAlign: { xs: 'left', sm: 'right' } }}><Typography sx={{ fontSize: '1.25rem', lineHeight: 1.4, fontWeight: 600, fontVariantNumeric: 'tabular-nums', overflowWrap: 'anywhere' }}>{debt.effectiveBalance === null ? 'Unavailable' : formatCurrency(debt.effectiveBalance)}</Typography><Typography variant="body2">Standard APR: {debt.apr === null ? 'Unknown' : `${debt.apr}%`}</Typography><Typography variant="body2">Minimum: {debt.minimumPayment === null ? 'Unknown' : `${formatCurrency(debt.minimumPayment)} / month`}</Typography></Box></Stack>
          {debt.sourceWarning && <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{debt.sourceWarning}</Typography>}
          {(debt.paymentRestrictions || debt.feeNotes) && <Typography variant="body2" sx={{ mt: 1, overflowWrap: 'anywhere' }}>Terms to review: {[debt.paymentRestrictions, debt.feeNotes].filter(Boolean).join(' · ')}</Typography>}
          <Stack direction="row" gap={1} sx={{ mt: 1.5 }}><Button size="small" variant="outlined" disabled={busy} onClick={() => { const record = (temporary ? localDebts : data?.workspace.data.debts ?? []).find(item => item.id === debt.id); if (record) setEditor({ ...record, ownerId: debt.ownerId }); setEditorError(''); }} aria-label={`Edit ${debt.name}`}>Edit details</Button><Button size="small" disabled={busy} onClick={() => { setRemove(debt); setEditorError(''); }} aria-label={`Remove ${debt.name}`}>Remove details</Button></Stack>
        </Box>)}</Stack>}
      </CardContent></Card>

      <Card sx={{ mb: 3 }}><CardContent><Typography variant="h6" component="h2">Compare repayment approaches</Typography><Typography variant="body2" sx={{ mt: 1, mb: 2 }}>Choose the total amount you can afford each month after essential costs and your safety cushion. It includes all minimum payments and any extra repayments.</Typography>
        <TextField label="Total monthly debt budget (£)" value={monthlyBudget} onChange={event => setMonthlyBudget(event.target.value)} inputProps={{ inputMode: 'decimal' }} helperText={monthlyBudget && !budgetValid ? 'Use a non-negative amount with up to 2 decimal places.' : 'An illustration using the debts entered above.'} error={Boolean(monthlyBudget && !budgetValid)} sx={{ width: { xs: '100%', sm: 320 } }} />
        {!debts.length && <Typography variant="body2" sx={{ mt: 2 }}>Add at least one debt to compare repayment plans.</Typography>}
      </CardContent></Card>
      {comparisons && <>
        {missing.length > 0 && <Alert severity="info" sx={{ mb: 3 }}><Typography variant="body2" sx={{ fontWeight: 700 }}>Your timeline needs these facts</Typography><Box component="ul" sx={{ mb: 0, pl: 2 }}>{missing.map(item => <li key={item}>{item}</li>)}</Box></Alert>}
        {warnings.length > 0 && <Alert severity="warning" sx={{ mb: 3 }}>{warnings.map(item => <Typography key={item} variant="body2" sx={{ mb: 0.5 }}>{item}</Typography>)}</Alert>}
        <Stack direction={{ xs: 'column', md: 'row' }} gap={2} sx={{ mb: 3 }}><ResultCard result={comparisons.avalanche} /><ResultCard result={comparisons.snowball} /></Stack>
        {comparisons.avalanche.status === 'paid_off' && comparisons.snowball.status === 'paid_off' && <Typography variant="body2" sx={{ mb: 3 }}>Illustrated interest difference: {formatCurrency(new Decimal(comparisons.snowball.totalInterest!).minus(comparisons.avalanche.totalInterest!).abs())}. Review your rates, promotional end dates and lender terms before making a decision.</Typography>}
        {result && result.schedule.length > 0 && <Accordion sx={{ mb: 3 }}><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography>Monthly payment illustration</Typography></AccordionSummary><AccordionDetails><TextField select label="Repayment approach" value={strategy} onChange={event => setStrategy(event.target.value as typeof strategy)} sx={{ mb: 2, width: { xs: '100%', sm: 280 } }}><MenuItem value="avalanche">Highest APR first</MenuItem><MenuItem value="snowball">Smallest balance first</MenuItem></TextField><TableContainer sx={{ overflowX: 'auto' }}><Table size="small"><TableHead><TableRow><TableCell>Payment date</TableCell><TableCell align="right">Interest</TableCell><TableCell align="right">Payment</TableCell><TableCell align="right">Remaining</TableCell></TableRow></TableHead><TableBody>{result.schedule.slice(0, 120).map(month => <TableRow key={month.date}><TableCell sx={{ whiteSpace: 'nowrap' }}>{dateLabel(month.date)}</TableCell><TableCell align="right">{formatCurrency(month.interest)}</TableCell><TableCell align="right">{formatCurrency(month.payment)}</TableCell><TableCell align="right">{formatCurrency(month.closingBalance)}</TableCell></TableRow>)}</TableBody></Table></TableContainer>{result.schedule.length > 120 && <Typography variant="caption">Showing the first 120 monthly payments.</Typography>}</AccordionDetails></Accordion>}
        <Accordion><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography>How the calculation works</Typography></AccordionSummary><AccordionDetails><Stack gap={1}>{comparisons.avalanche.methodology.map(item => <Typography key={item} variant="body2">{item}</Typography>)}</Stack></AccordionDetails></Accordion>
      </>}
      <Button component={Link} href="/plan" sx={{ mt: 3 }}>Review my wider financial plan</Button>
    </>}

    <Dialog open={Boolean(editor)} onClose={() => { if (!busy) setEditor(null); }} fullWidth maxWidth="sm">
      <Box component="form" onSubmit={saveEditor}><DialogTitle>{savedDebt ? 'Edit debt details' : temporary ? 'Temporary calculator debt' : 'Add debt details'}</DialogTitle><DialogContent><Stack gap={2} sx={{ pt: 1 }}>
        {temporary && <Alert severity="info">Calculator only. These entries will not be saved or included in your account balances.</Alert>}
        {editorError && <Alert severity="error">{editorError}</Alert>}
        {conflict && <Alert severity="warning" action={<Button onClick={() => void mutate()} disabled={busy}>Reload saved debts</Button>}>Another session changed your debts. Your form is preserved. Reload and review the saved list before retrying.</Alert>}
        {editor && <>
          <TextField label="Debt name" required value={editor.name} disabled={busy} onChange={event => patch({ name: event.target.value })} inputProps={{ maxLength: 160 }} />
          {!temporary && <TextField select label="Balance source" value={editor.accountId ?? ''} disabled={busy} onChange={event => { const account = data?.accounts.find(account => account.id === Number(event.target.value)); patch(account ? { accountId: account.id, ownerId: account.ownerId, statementBalance: null, statementAsOf: null } : { accountId: null, statementBalance: null, statementAsOf: londonTodayIso() }); }}><MenuItem value="">My statement (no ledger link)</MenuItem>{data?.accounts.map(account => <MenuItem key={account.id} value={account.id}>{account.name}</MenuItem>)}</TextField>}
          {editor.accountId === null ? <><TextField label="Statement amount owed (£)" required value={editor.statementBalance ?? ''} disabled={busy} onChange={event => patch({ statementBalance: event.target.value || null })} inputProps={{ inputMode: 'decimal' }} /><TextField label="Statement date" type="date" required value={editor.statementAsOf ?? ''} disabled={busy} onChange={event => patch({ statementAsOf: event.target.value || null })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: londonTodayIso() } }} /></> : <Alert severity="info">The linked liability ledger supplies the balance as of today. Editing these details does not change it.</Alert>}
          {!temporary && <TextField select label="Owner" value={editor.ownerId ?? ''} disabled={busy || editor.accountId !== null} onChange={event => patch({ ownerId: event.target.value ? Number(event.target.value) : null })} helperText={editor.accountId !== null ? 'Ownership comes from the linked liability account.' : 'Leave blank for unallocated household debt.'}><MenuItem value="">Unallocated / household</MenuItem>{data?.owners.map(owner => <MenuItem key={owner.id} value={owner.id}>{owner.name}</MenuItem>)}</TextField>}
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label="Standard APR (%)" value={editor.apr ?? ''} disabled={busy} onChange={event => patch({ apr: event.target.value || null })} inputProps={{ inputMode: 'decimal' }} helperText="Blank means unknown; 0 must be explicit." fullWidth /><TextField label="Minimum per month (£)" value={editor.minimumPayment ?? ''} disabled={busy} onChange={event => patch({ minimumPayment: event.target.value || null })} inputProps={{ inputMode: 'decimal' }} helperText="Recorded fixed minimum for this illustration." fullWidth /></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}><TextField label="Promotional APR (%)" value={editor.promotionalApr ?? ''} disabled={busy} onChange={event => patch({ promotionalApr: event.target.value || null })} inputProps={{ inputMode: 'decimal' }} fullWidth /><TextField label="Promotion expires on" type="date" value={editor.promotionalExpiresOn ?? ''} disabled={busy} onChange={event => patch({ promotionalExpiresOn: event.target.value || null })} slotProps={{ inputLabel: { shrink: true } }} helperText="Standard APR applies from this date." fullWidth /></Stack>
          <FormControlLabel control={<Checkbox checked={editor.priority} disabled={busy} onChange={event => patch({ priority: event.target.checked })} />} label="Priority debt / essential repayment" />
          <FormControlLabel control={<Checkbox checked={editor.inArrears} disabled={busy} onChange={event => patch({ inArrears: event.target.checked })} />} label="Currently in arrears" />
          <Typography variant="caption">Priority concerns depend on the consequences of missed payments, such as losing your home or essential services. Check with free debt advice if unsure.</Typography>
          <TextField label="Payment restrictions to review" multiline minRows={2} value={editor.paymentRestrictions} disabled={busy} onChange={event => patch({ paymentRestrictions: event.target.value })} helperText="Examples: overpayment caps or restrictions. A note pauses forecasts until terms are reviewed." inputProps={{ maxLength: 1000 }} />
          <TextField label="Fees or charges to review" multiline minRows={2} value={editor.feeNotes} disabled={busy} onChange={event => patch({ feeNotes: event.target.value })} helperText="Examples: exit fees or missed-payment charges. These are not modelled automatically." inputProps={{ maxLength: 1000 }} />
        </>}
      </Stack></DialogContent><DialogActions><Button disabled={busy} onClick={() => setEditor(null)}>Cancel</Button><Button type="submit" variant="contained" disabled={busy || conflict}>{busy ? 'Saving…' : temporary ? 'Use in calculator' : 'Save debt details'}</Button></DialogActions></Box>
    </Dialog>
    <Dialog open={Boolean(remove)} onClose={() => { if (!busy) setRemove(null); }}><DialogTitle>Remove debt details?</DialogTitle><DialogContent>{editorError && <Alert severity="error" sx={{ mb: 2 }}>{editorError}</Alert>}{conflict && <Alert severity="warning" action={<Button onClick={() => void mutate()}>Reload saved debts</Button>} sx={{ mb: 2 }}>Another session changed your debts. Reload before retrying.</Alert>}<Typography>Remove {remove?.name} from this workspace? Your ledger entries and account balance are preserved.</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => setRemove(null)}>Cancel</Button><Button color="error" disabled={busy || conflict} onClick={() => void removeDebt()}>Remove details</Button></DialogActions></Dialog>
  </Box>;
}
