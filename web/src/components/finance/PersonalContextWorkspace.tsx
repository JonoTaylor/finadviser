'use client';

import { useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import {
  Alert, Box, Button, Card, CardContent, Checkbox, Chip, Divider,
  FormControlLabel, MenuItem, Skeleton, Stack, TextField, Typography,
} from '@mui/material';
import PersonOutlineRoundedIcon from '@mui/icons-material/PersonOutlineRounded';
import FactCheckRoundedIcon from '@mui/icons-material/FactCheckRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import { formatCurrency } from '@/lib/utils/formatting';
import {
  cashExclusionReason, contextSchema, financePriorities, resolveCashAccessibility,
  type ContextAccount, type ContextWorkspace, type FinancialContext,
} from '@/lib/finance-context/schema';
import { serifFamily, softTokens } from '@/theme/theme';

const priorityLabels = { spending: 'Spend less', wealth: 'Build wealth', property: 'Manage properties', pensions: 'Plan retirement' };
const regionLabels = { england: 'England', wales: 'Wales', scotland: 'Scotland', northern_ireland: 'Northern Ireland' };

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

function postingAge(account: ContextAccount, asOf: string): number | null {
  if (!account.latestJournalDate) return null;
  return Math.floor((new Date(`${asOf}T00:00:00Z`).getTime() - new Date(`${account.latestJournalDate}T00:00:00Z`).getTime()) / 86_400_000);
}

function classification(account: ContextAccount): string {
  if (account.accountType === 'LIABILITY') return 'Liability';
  if (account.isPropertyAsset) return 'Property asset';
  if (account.investmentKind === 'pension' || /\bpension\b/i.test(account.name)) return 'Pension';
  if (account.isInvestment) return account.investmentKind === 'savings' ? 'Savings account' : 'Market investment';
  if (cashExclusionReason(account)) return 'Possible market investment';
  if (resolveCashAccessibility(account, { accountAccessibility: [] }).eligible) return 'Cash candidate';
  return 'Asset · accessibility unconfirmed';
}

export default function PersonalContextWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<ContextWorkspace>('/api/finance/context', fetchJson, {
    shouldRetryOnError: false, revalidateOnFocus: false,
  });

  return (
    <Box sx={{ pt: { xs: 4, md: 0 } }}>
      <Typography variant="overline" sx={{ color: softTokens.mint.ink, letterSpacing: '0.14em' }}>Advice that starts with you</Typography>
      <Typography variant="h4" component="h1">Your financial context</Typography>
      <Typography variant="body2" sx={{ mt: 1, mb: 3, maxWidth: 740 }}>Choose the ledger owner who represents you, record the facts that affect your plan, and review which savings you can actually access. Unknown details stay unknown.</Typography>

      {isLoading ? <Stack gap={3}><Skeleton variant="rounded" height={240} /><Skeleton variant="rounded" height={360} /></Stack> : error ? (
        <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your saved context and account records could not be loaded. Balances and personal facts are unavailable. {error.message}</Alert>
      ) : data ? <ContextEditor workspace={data} onSaved={saved => mutate(saved, { revalidate: false })} /> : null}
    </Box>
  );
}

function ContextEditor({ workspace, onSaved }: { workspace: ContextWorkspace; onSaved: (workspace: ContextWorkspace) => Promise<unknown> }) {
  const [context, setContext] = useState<FinancialContext>(workspace.data);
  const [dependantsInput, setDependantsInput] = useState(workspace.data.dependants === null ? '' : String(workspace.data.dependants));
  const [revision, setRevision] = useState(workspace.revision);
  const [updatedAt, setUpdatedAt] = useState(workspace.updatedAt);
  const [issues, setIssues] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const lookup = workspace.lookup;
  const accounts = lookup.accounts;
  const ownerNames = new Map(lookup.owners.map(owner => [owner.id, owner.name]));
  const unattributed = accounts.filter(account => account.ownerId === null).length;
  const noPostings = accounts.filter(account => account.latestJournalDate === null).length;
  const olderPostings = accounts.filter(account => (postingAge(account, lookup.asOf) ?? 0) > 30).length;
  const currentContext = { ...context, dependants: dependantsInput.trim() === '' ? null : Number(dependantsInput) };

  const change = <K extends keyof FinancialContext>(key: K, value: FinancialContext[K]) => {
    setContext(previous => ({ ...previous, [key]: value }));
    setIssues(previous => ({ ...previous, [key]: '' }));
    setSaved(false);
  };

  const changeAccessibility = (accountId: number, value: string) => {
    const other = context.accountAccessibility.filter(item => item.accountId !== accountId);
    change('accountAccessibility', value ? [...other, { accountId, accessibility: value as 'available' | 'restricted' | 'excluded' }] : other);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busyRef.current) return;
    const parsed = contextSchema.safeParse(currentContext);
    if (!parsed.success) {
      setIssues(Object.fromEntries(parsed.error.issues.map(issue => [String(issue.path[0]), issue.message])));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setSaveError('');
    setSaved(false);
    try {
      const response = await fetch('/api/finance/context', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: parsed.data, revision }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setConflict(response.status === 409);
        throw new Error(typeof body?.error === 'string' ? body.error : 'Your context could not be saved. Please retry.');
      }
      if (!body || !contextSchema.safeParse(body.data).success || !Number.isInteger(body.revision)) throw new Error('The server returned an unreadable response. Your entries are still here.');
      const result = body as ContextWorkspace;
      await onSaved(result);
      setContext(result.data);
      setDependantsInput(result.data.dependants === null ? '' : String(result.data.dependants));
      setRevision(result.revision);
      setUpdatedAt(result.updatedAt);
      setIssues({});
      setConflict(false);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Your context could not be saved. Please retry.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const reload = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const latest = await fetchJson<ContextWorkspace>('/api/finance/context');
      await onSaved(latest);
      setContext(latest.data);
      setDependantsInput(latest.data.dependants === null ? '' : String(latest.data.dependants));
      setRevision(latest.revision);
      setUpdatedAt(latest.updatedAt);
      setConflict(false);
      setSaveError('');
      setIssues({});
      setSaved(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'The saved version could not be reloaded. Your entries are still here.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <Box component="form" onSubmit={submit} noValidate>
      {saveError && <Alert severity={conflict ? 'warning' : 'error'} sx={{ mb: 3 }}>{saveError} {conflict ? 'Another session saved a newer version. Your unsaved entries are preserved below. Reloading replaces them with the saved version.' : 'Your entries are still here.'}{conflict && <Box sx={{ mt: 1 }}><Button size="small" onClick={() => void reload()} disabled={busy}>Reload saved version</Button></Box>}</Alert>}
      {saved && <Alert severity="success" sx={{ mb: 3 }}>Your context has been saved. Your plan will use these confirmed details.</Alert>}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}><PersonOutlineRoundedIcon sx={{ color: softTokens.mint.ink }} /><Typography variant="h6" component="h2">About you</Typography></Stack>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2.5 }}>
            <TextField label="Preferred name" value={context.preferredName} onChange={event => change('preferredName', event.target.value)} disabled={busy} error={Boolean(issues.preferredName)} helperText={issues.preferredName || 'Jono is the name you have given us. Edit it whenever you like.'} slotProps={{ htmlInput: { maxLength: 80 } }} />
            <TextField select label="Your ledger owner" value={context.ownerId ?? ''} onChange={event => change('ownerId', event.target.value === '' ? null : Number(event.target.value))} disabled={busy} error={Boolean(issues.ownerId)} helperText={issues.ownerId || 'Choose your own record. Shared or unattributed accounts remain separate.'}>
              <MenuItem value="">Not selected · personal ownership unknown</MenuItem>
              {context.ownerId !== null && !ownerNames.has(context.ownerId) && <MenuItem value={context.ownerId}>Previously selected owner is unavailable</MenuItem>}
              {lookup.owners.map(owner => <MenuItem value={owner.id} key={owner.id}>{owner.name}</MenuItem>)}
            </TextField>
            <TextField select label="UK tax residence" value={context.taxResidence ?? ''} onChange={event => change('taxResidence', event.target.value === '' ? null : event.target.value as FinancialContext['taxResidence'])} disabled={busy} helperText="Choose the UK region that applies to you. Leave unknown if you need to check.">
              <MenuItem value="">Unknown or not established</MenuItem>
              {Object.entries(regionLabels).map(([value, label]) => <MenuItem key={value} value={value}>{label}</MenuItem>)}
            </TextField>
            <TextField label="People financially dependent on you" value={dependantsInput} onChange={event => { setDependantsInput(event.target.value); setSaved(false); setIssues(previous => ({ ...previous, dependants: '' })); }} disabled={busy} error={Boolean(issues.dependants)} helperText={issues.dependants || 'Leave blank if unknown. Enter 0 only if you have no dependants.'} slotProps={{ htmlInput: { inputMode: 'numeric' } }} />
            <TextField select label="Employment income stability" value={context.employmentStability ?? ''} onChange={event => change('employmentStability', event.target.value === '' ? null : event.target.value as FinancialContext['employmentStability'])} disabled={busy} helperText="This describes your situation; it is not inferred from transactions.">
              <MenuItem value="">Unknown</MenuItem><MenuItem value="stable">Generally stable</MenuItem><MenuItem value="variable">Variable or uncertain</MenuItem><MenuItem value="not_working">Not currently working</MenuItem>
            </TextField>
            <TextField label="Next financial review (optional)" type="date" value={context.nextReviewDate ?? ''} onChange={event => change('nextReviewDate', event.target.value || null)} disabled={busy} error={Boolean(issues.nextReviewDate)} helperText={issues.nextReviewDate || 'A date to revisit your assumptions, spending and goals.'} slotProps={{ inputLabel: { shrink: true } }} />
          </Box>
          <Divider sx={{ my: 3 }} />
          <Typography variant="subtitle2" component="h3">What your adviser should work on</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, mb: 1 }}>All four areas are selected because you asked for a complete financial home. Keep the areas that matter to you.</Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={{ xs: 0, sm: 2 }} flexWrap="wrap">
            {financePriorities.map(priority => <FormControlLabel key={priority} control={<Checkbox checked={context.priorities.includes(priority)} onChange={event => change('priorities', event.target.checked ? [...context.priorities, priority] : context.priorities.filter(item => item !== priority))} disabled={busy} />} label={priorityLabels[priority]} />)}
          </Stack>
          {issues.priorities && <Typography variant="caption" color="error">{issues.priorities}</Typography>}
          {!lookup.owners.length && <Alert severity="info" sx={{ mt: 2 }}>No ledger owners are recorded yet. Create the correct owner in <Link href="/properties">Properties</Link> before selecting your personal record. No owner has been chosen automatically.</Alert>}
          {context.ownerId === null && lookup.owners.length > 0 && <Alert severity="info" sx={{ mt: 2 }}>Your personal owner is not selected. Household information can still be shown, while your own ownership remains unknown.</Alert>}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3, bgcolor: softTokens.cream }}>
        <CardContent>
          <Stack direction="row" alignItems="center" gap={1} sx={{ mb: 2 }}><FactCheckRoundedIcon sx={{ color: softTokens.mint.ink }} /><Typography variant="h6" component="h2">Know what your records cover</Typography></Stack>
          <Stack direction={{ xs: 'column', sm: 'row' }} gap={3}>
            {[[accounts.length, 'Asset and liability accounts', `Recorded balances as at ${formatDate(lookup.asOf)}`], [unattributed, 'Shared or unattributed', 'No individual owner is attached in the ledger'], [olderPostings + noPostings, 'Posting dates to review', `${olderPostings} older than 30 days · ${noPostings} with no postings`]].map(([value, label, detail]) => <Box key={String(label)} sx={{ flex: 1, minWidth: 0 }}><Typography variant="h3" sx={{ fontFamily: serifFamily }}>{value}</Typography><Typography variant="subtitle2" sx={{ mt: 0.5 }}>{label}</Typography><Typography variant="caption">{detail}</Typography></Box>)}
          </Stack>
          <Divider sx={{ my: 2 }} />
          <Typography variant="body2">A recent journal posting is evidence of recorded activity. It does not verify the bank&apos;s current balance, prove a statement is complete, or confirm that every account has been imported.</Typography>
        </CardContent>
      </Card>

      <Typography variant="h6" component="h2" sx={{ mb: 1 }}>Accounts &amp; accessible savings</Typography>
      <Typography variant="body2" sx={{ mb: 2, maxWidth: 760 }}>Confirm whether cash can be used when you need it. Automatic classifications are estimates. Pensions, market investments, property and liabilities always remain outside the accessible emergency reserve.</Typography>
      {issues.accountAccessibility && <Alert severity="error" sx={{ mb: 2 }}>{issues.accountAccessibility}</Alert>}
      {context.accountAccessibility.some(item => !accounts.some(account => account.id === item.accountId)) && <Alert severity="warning" sx={{ mb: 2 }}>A saved accessibility setting refers to an account that is no longer available. <Button size="small" disabled={busy} onClick={() => change('accountAccessibility', context.accountAccessibility.filter(item => accounts.some(account => account.id === item.accountId)))}>Remove unavailable settings</Button></Alert>}
      {accounts.length === 0 ? <Alert severity="info">No asset or liability accounts are recorded yet. <Link href="/import">Import your statements</Link> to start building a financial picture.</Alert> : <Stack gap={2}>
        {accounts.map(account => {
          const exclusion = cashExclusionReason(account);
          const resolution = resolveCashAccessibility(account, currentContext);
          const override = context.accountAccessibility.find(item => item.accountId === account.id);
          const age = postingAge(account, lookup.asOf);
          const ownerLabel = account.ownerId === null ? 'Shared / unattributed' : ownerNames.get(account.ownerId) ?? 'Owner record unavailable';
          return <Card key={account.id} component="article" aria-label={account.name}>
            <CardContent>
              <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'flex-start' }} gap={2}>
                <Box sx={{ flex: 1, minWidth: 0 }}><Typography variant="h6" component="h3" sx={{ overflowWrap: 'anywhere' }}>{account.name}</Typography><Typography variant="caption">{ownerLabel} · {classification(account)} · account #{account.id}</Typography></Box>
                <Box sx={{ flexShrink: 0 }}><Typography variant="h5" sx={{ overflowWrap: 'anywhere' }}>{formatCurrency(account.balance)}</Typography><Typography variant="caption">Recorded balance{account.accountType === 'LIABILITY' ? ' · negative means owed' : ''}</Typography></Box>
              </Stack>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ my: 2 }}>
                <Chip size="small" label={account.latestJournalDate ? `Last posting ${formatDate(account.latestJournalDate)}` : 'No recorded postings'} color={age !== null && age <= 30 ? 'default' : 'warning'} />
                <Chip size="small" label={exclusion ? 'Outside cash reserve' : resolution.source === 'confirmed' ? resolution.eligible ? 'Access confirmed by you' : 'Restricted or excluded by you' : resolution.eligible ? 'Cash access inferred' : 'Cash access unconfirmed'} variant="outlined" />
                {account.futurePostingCount > 0 && <Chip size="small" label={`${account.futurePostingCount} future ${account.futurePostingCount === 1 ? 'posting excluded' : 'postings excluded'}`} variant="outlined" />}
              </Stack>
              {exclusion ? <Box><Typography variant="body2" color="text.secondary">{exclusion}.{override?.accessibility === 'available' ? ' Your saved “available” setting cannot include this asset in the cash reserve.' : ''}</Typography>{override && <Button size="small" disabled={busy} onClick={() => changeAccessibility(account.id, '')}>Use automatic exclusion</Button>}</Box> : <TextField select fullWidth label={`Cash accessibility: ${account.name}`} value={override?.accessibility ?? ''} onChange={event => changeAccessibility(account.id, event.target.value)} disabled={busy} helperText="Your confirmation changes planning assumptions; it does not change the ledger balance or account ownership.">
                <MenuItem value="">Automatic estimate · not confirmed</MenuItem><MenuItem value="available">Available when I need it</MenuItem><MenuItem value="restricted">Restricted, locked or subject to notice</MenuItem><MenuItem value="excluded">Exclude from my emergency reserve</MenuItem>
              </TextField>}
              {!account.postingCount && <Typography variant="caption" sx={{ display: 'block', mt: 1 }}>No balance postings have been recorded. A displayed zero does not confirm that this account is empty.</Typography>}
            </CardContent>
          </Card>;
        })}
      </Stack>}
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }} gap={2} sx={{ mt: 3 }}>
        <Box><Typography variant="caption">{updatedAt ? `Last saved ${new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/London' }).format(new Date(updatedAt))} · revision ${revision}` : 'These details have not been saved yet.'}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>Saving records your context and account access preferences. It does not move money.</Typography></Box>
        <Button type="submit" variant="contained" disabled={busy || conflict} sx={{ flexShrink: 0 }}>{busy ? 'Saving…' : 'Save my context'}</Button>
      </Stack>
      <Button component={Link} href="/plan" endIcon={<ArrowForwardRoundedIcon />} sx={{ mt: 2 }}>Review my financial plan</Button>
    </Box>
  );
}
