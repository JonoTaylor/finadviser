'use client';

import { useState } from 'react';
import Link from 'next/link';
import Decimal from 'decimal.js';
import useSWR from 'swr';
import {
  Accordion, AccordionDetails, AccordionSummary, Alert, Box, Button, Card,
  CardContent, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  Grid, LinearProgress, MenuItem, Skeleton, Stack, TextField, Typography,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import MetricCard from '@/components/ui/MetricCard';
import { fetchJson } from '@/lib/http/client';
import { londonTodayIso } from '@/lib/dates/today';
import { formatCurrency } from '@/lib/utils/formatting';
import { ASSET_CLASSES, ASSET_CLASS_LABELS, holdingSchema, platformSchema, type AssetClass, type PortfolioData, type PortfolioHolding } from '@/lib/portfolio/schema';
import type { PortfolioWorkspaceResponse } from '@/lib/portfolio/load';

interface HoldingForm {
  id: string; accountId: string; name: string; assetClass: AssetClass;
  value: string; valuationDate: string; feeRate: string; provider: string;
}
function fromHolding(holding: PortfolioHolding): HoldingForm {
  return { ...holding, accountId: String(holding.accountId), feeRate: holding.feeRate ?? '', provider: holding.provider ?? '' };
}
function metric(label: string, value: string, detail: string) {
  return <MetricCard label={label} value={value} detail={detail} />;
}

export default function PortfolioWorkspace() {
  const { data, error, isLoading, mutate } = useSWR<PortfolioWorkspaceResponse>('/api/portfolio', fetchJson, { shouldRetryOnError: false, revalidateOnFocus: false });
  const [holdingForm, setHoldingForm] = useState<HoldingForm | null>(null);
  const [platformForm, setPlatformForm] = useState<{ accountId: number; feeRate: string } | null>(null);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [removeOrphans, setRemoveOrphans] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [message, setMessage] = useState('');

  const openHolding = (accountId: number, holding?: PortfolioHolding) => {
    setFormError(''); setMessage('');
    setHoldingForm(holding ? fromHolding(holding) : {
      id: crypto.randomUUID(), accountId: String(accountId), name: '', assetClass: 'equity',
      value: '', valuationDate: londonTodayIso(), feeRate: '', provider: '',
    });
  };
  const saveData = async (nextData: PortfolioData) => {
    if (!data || busy) return false;
    setBusy(true); setFormError(''); setMessage('');
    try {
      const saved = await fetchJson<PortfolioWorkspaceResponse>('/api/portfolio', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data: nextData, revision: data.workspace.revision }),
      });
      await mutate(saved, false);
      setMessage('Portfolio records saved. Account balances and net worth are unchanged.');
      return true;
    } catch (saveError) {
      setFormError(saveError instanceof Error ? saveError.message : 'Your portfolio could not be saved. Please try again.');
      return false;
    } finally { setBusy(false); }
  };
  const saveHolding = async () => {
    if (!holdingForm || !data) return;
    const parsed = holdingSchema.safeParse({
      ...holdingForm, accountId: Number(holdingForm.accountId), currency: 'GBP',
      feeRate: holdingForm.feeRate.trim() === '' ? null : holdingForm.feeRate.trim(),
      provider: holdingForm.provider.trim() === '' ? null : holdingForm.provider.trim(),
      value: holdingForm.value.trim(),
    });
    if (!parsed.success) { setFormError(parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')); return; }
    if (parsed.data.valuationDate > londonTodayIso()) { setFormError('Use a statement date on or before today.'); return; }
    const holdings = [...data.workspace.data.holdings.filter(holding => holding.id !== parsed.data.id), parsed.data];
    if (await saveData({ ...data.workspace.data, holdings })) setHoldingForm(null);
  };
  const savePlatform = async () => {
    if (!platformForm || !data) return;
    const parsed = platformSchema.safeParse({ ...platformForm, feeRate: platformForm.feeRate.trim() === '' ? null : platformForm.feeRate.trim() });
    if (!parsed.success) { setFormError(parsed.error.issues.map(issue => issue.message).join('; ')); return; }
    const platforms = [...data.workspace.data.platforms.filter(platform => platform.accountId !== parsed.data.accountId), parsed.data];
    if (await saveData({ ...data.workspace.data, platforms })) setPlatformForm(null);
  };
  const removeHolding = async () => {
    if (!data || (!removeId && !removeOrphans)) return;
    const accountIds = new Set(data.accounts.map(account => account.id));
    const nextData = removeOrphans ? {
      holdings: data.workspace.data.holdings.filter(holding => accountIds.has(holding.accountId)),
      platforms: data.workspace.data.platforms.filter(platform => accountIds.has(platform.accountId)),
    } : { ...data.workspace.data, holdings: data.workspace.data.holdings.filter(holding => holding.id !== removeId) };
    if (await saveData(nextData)) { setRemoveId(null); setRemoveOrphans(false); }
  };
  const formAlert = formError ? <Alert severity="error" sx={{ mb: 2 }} action={<Button disabled={busy} color="inherit" onClick={() => void mutate()}>Reload records</Button>}>{formError}</Alert> : null;

  if (isLoading) return <Stack spacing={2}><Skeleton variant="rounded" height={150} /><Skeleton variant="rounded" height={240} /></Stack>;
  if (error || !data) return <Card><CardContent><Stack spacing={2}>
    <Typography variant="h5">Your portfolio needs its records</Typography>
    <Alert severity="warning">{error instanceof Error ? error.message : 'Portfolio records could not be loaded.'}</Alert>
    <Typography color="text.secondary">Connect the database and add your real investment accounts before recording holdings. An unavailable connection does not mean your investments are worth zero.</Typography>
    <Stack direction="row" gap={1} flexWrap="wrap"><Button onClick={() => void mutate()}>Try again</Button><Button component={Link} href="/investments" variant="outlined">Investment accounts</Button></Stack>
  </Stack></CardContent></Card>;

  const { analysis, workspace } = data;
  const negativeAccount = analysis.accounts.some(account => new Decimal(account.balance).lt(0));
  return <Stack spacing={3}>
    {message && <Alert severity="success" onClose={() => setMessage('')}>{message}</Alert>}
    <Box sx={{ pb: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="body2">Household overview · ledger cutoff {analysis.asOf} · GBP</Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>Holdings describe balances already included in your finances. Values are manually recorded; update them from provider statements.</Typography>
    </Box>
    {analysis.hasInconsistencies && <Alert severity="warning">Some holdings do not reconcile with the current ledger. Review the account warnings before relying on allocation or fee figures.</Alert>}
    <Grid container spacing={2}>
      <Grid size={{ xs: 6, lg: 3 }}>{metric('Recorded account value', formatCurrency(analysis.totalLedgerBalance), `${analysis.accounts.length} investment accounts, all owners`)}</Grid>
      <Grid size={{ xs: 6, lg: 3 }}>{metric('Holdings recorded', formatCurrency(analysis.totalAllocated), analysis.allocationCoveragePercent === null ? 'No positive account balance to compare' : `${analysis.allocationCoveragePercent}% of positive account value${analysis.hasInconsistencies ? ' · review gaps' : ''}`)}</Grid>
      <Grid size={{ xs: 6, lg: 3 }}>{metric('Unclassified value', formatCurrency(analysis.totalUnclassified), `Reconciliation excess ${formatCurrency(analysis.totalOverallocated)}`)}</Grid>
      <Grid size={{ xs: 6, lg: 3 }}>{metric('Known annual charges', formatCurrency(analysis.fees.annualKnownCharges), analysis.fees.complete ? 'Illustrative percentage charges; exclusions apply' : 'Partial estimate: some fees or holdings are unknown')}</Grid>
    </Grid>
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 7 }}><Card sx={{ height: '100%' }}><CardContent>
        <Typography variant="h6" sx={{ mb: 0.75 }}>Recorded asset mix</Typography>
        <Typography variant="body2" sx={{ mb: 2.5 }}>Percentages describe recorded holdings. Unclassified value is shown separately; pensions and ISAs are account wrappers.</Typography>
        {new Decimal(analysis.totalAllocated).eq(0) ? <Typography color="text.secondary">Add the funds or assets from your statements to see your allocation.</Typography> : <Stack spacing={2}>
          {analysis.allocations.filter(item => new Decimal(item.value).gt(0)).map(item => <Box key={item.assetClass}>
            <Stack direction="row" justifyContent="space-between" gap={2} sx={{ mb: 0.75 }}><Typography variant="body2" sx={{ fontWeight: 500 }}>{ASSET_CLASS_LABELS[item.assetClass]}</Typography><Typography variant="body2" sx={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(item.value)} · {item.percentOfRecordedHoldings}%</Typography></Stack>
            <LinearProgress variant="determinate" value={item.percentOfRecordedHoldings ?? 0} sx={{ height: 5, borderRadius: '4px', bgcolor: '#eef2f6', '& .MuiLinearProgress-bar': { bgcolor: '#0f766e' } }} />
          </Box>)}
        </Stack>}
      </CardContent></Card></Grid>
      <Grid size={{ xs: 12, md: 5 }}><Card sx={{ height: '100%' }}><CardContent><Stack spacing={2}>
        <Typography variant="h6">Concentration &amp; fee visibility</Typography>
        {analysis.largestHolding ? <Typography variant="body2">Largest recorded holding: <strong>{analysis.largestHolding.name}</strong>, {analysis.largestHolding.percentOfRecordedHoldings}% of holdings. A fund may itself be diversified; its underlying exposures are not available here.</Typography> : <Typography variant="body2">Record holdings to assess concentration. An account provider or wrapper does not reveal its investments.</Typography>}
        <Divider />
        <Typography variant="body2">Holding charges known on {analysis.fees.holdingFeeCoveragePercent === null ? 'no recorded holdings' : `${analysis.fees.holdingFeeCoveragePercent}% of recorded holdings`}. Unknown holding fee value: {formatCurrency(analysis.fees.holdingFeeUnknownValue)}.</Typography>
        <Typography variant="body2">Platform percentages recorded for {analysis.fees.platformFeeKnownAccountCount} of {analysis.fees.accountCount} accounts. Record 0 only when a provider confirms no percentage fee.</Typography>
        <Typography variant="caption">Known charges are illustrative annual amounts at recorded values. Fixed charges, caps, dealing costs and rebates may change your actual fees.</Typography>
      </Stack></CardContent></Card></Grid>
    </Grid>
    <Stack direction="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap={1}>
      <Typography variant="h6" component="h2">Accounts &amp; holdings</Typography><Button component={Link} href="/investments" variant="outlined" size="small">Manage account balances</Button>
    </Stack>
    {analysis.accounts.length === 0 && <Alert severity="info">Add a real investment account first, then record its holdings here. A pension can contain equities, bonds, cash or a mixture.</Alert>}
    {analysis.accounts.map(account => <Card key={account.id}><CardContent><Stack spacing={2}>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
        <Box sx={{ minWidth: 0 }}><Typography variant="h6" sx={{ overflowWrap: 'anywhere' }}>{account.name}</Typography><Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mt: 0.75 }}>
          {account.investmentKind && <Chip label={account.investmentKind.toUpperCase()} size="small" variant="outlined" />}
          <Typography variant="caption">{account.ownerName ?? 'Owner not recorded'} · balance {formatCurrency(account.balance)} · {account.balanceAsOf}</Typography>
        </Stack></Box>
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ flexShrink: 0 }}><Button size="small" variant="outlined" disabled={busy} onClick={() => { setFormError(''); setPlatformForm({ accountId: account.id, feeRate: account.platformFeeRate ?? '' }); }}>Platform fee</Button><Button size="small" disabled={busy || new Decimal(account.balance).lt(0)} variant="contained" startIcon={<AddRoundedIcon />} onClick={() => openHolding(account.id)}>Add holding</Button></Stack>
      </Stack>
      {account.warnings.map(warning => <Alert key={warning} severity="warning">{warning}</Alert>)}
      <Stack direction="row" gap={{ xs: 1.5, sm: 3 }} flexWrap="wrap" sx={{ py: 1.5, borderTop: '1px solid', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2">Recorded <Box component="span" sx={{ fontWeight: 600, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(account.allocated)}</Box></Typography>
        <Typography variant="body2">Unclassified <Box component="span" sx={{ fontWeight: 600, color: new Decimal(account.unclassified).gt(0) ? 'warning.dark' : 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(account.unclassified)}</Box></Typography>
        {new Decimal(account.overallocated).gt(0) && <Typography variant="body2" color="error.main">Excess {formatCurrency(account.overallocated)}</Typography>}
        <Typography variant="body2">{account.platformFeeRate === null ? 'Platform fee unknown' : `Platform ${account.platformFeeRate}% yearly`}</Typography>
      </Stack>
      {account.holdings.length === 0 ? <Typography variant="body2" color="text.secondary">No holdings recorded. Check the statement for the underlying investments and their charges.</Typography> : <Stack divider={<Divider />} spacing={1.75}>{account.holdings.map(holding => <Box key={holding.id}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2}>
          <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}><Typography fontWeight={600}>{holding.name}</Typography><Typography variant="body2">{ASSET_CLASS_LABELS[holding.assetClass]}{holding.provider ? ` · ${holding.provider}` : ''}</Typography><Typography variant="caption">Statement {holding.valuationDate} · annual holding fee {holding.feeRate === null ? 'unknown' : `${holding.feeRate}%`}</Typography></Box>
          <Stack spacing={0.5} alignItems={{ xs: 'flex-start', sm: 'flex-end' }} sx={{ flexShrink: 0 }}><Typography sx={{ fontSize: 20, fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(holding.value)}</Typography><Stack direction="row" spacing={0.5}><Button size="small" disabled={busy} onClick={() => openHolding(account.id, holding)} aria-label={`Edit ${holding.name}`}>Edit</Button><Button size="small" disabled={busy} onClick={() => { setFormError(''); setRemoveId(holding.id); }} aria-label={`Remove ${holding.name}`}>Remove</Button></Stack></Stack>
        </Stack>
      </Box>)}</Stack>}
      {account.staleHoldingCount > 0 && <Typography variant="caption">{account.staleHoldingCount} holding snapshot{account.staleHoldingCount === 1 ? '' : 's'} more than 30 days old. Refresh from a provider statement when useful.</Typography>}
      <Typography variant="caption">Known annual account charges {formatCurrency(account.annualKnownCharges)}{account.feesComplete ? ' · percentage fee inputs complete' : ' · partial estimate'}. Platform charges apply to the positive ledger balance; holding charges apply to each recorded holding.</Typography>
    </Stack></CardContent></Card>)}
    {(analysis.orphanHoldings.length > 0 || analysis.orphanPlatforms.length > 0) && <Card><CardContent><Stack spacing={2}>
      <Typography variant="h6">Records with missing investment accounts</Typography>
      <Alert severity="warning">These records are excluded from allocation and fee totals. Remove them or restore the correct investment account.</Alert>
      {analysis.orphanHoldings.map(holding => <Typography key={holding.id} sx={{ overflowWrap: 'anywhere' }}>{holding.name} · {formatCurrency(holding.value)}</Typography>)}
      {analysis.orphanPlatforms.map(platform => <Typography key={platform.accountId}>Platform fee for missing account {platform.accountId}</Typography>)}
      <Box><Button disabled={busy} onClick={() => { setFormError(''); setRemoveOrphans(true); }}>Remove all unlinked records</Button></Box>
    </Stack></CardContent></Card>}
    {negativeAccount && <Typography variant="caption">Negative account balances remain in the household total; allocation percentages use positive account balances.</Typography>}
    <Accordion><AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}><Typography>How these figures work</Typography></AccordionSummary><AccordionDetails><Stack spacing={1}>
      {analysis.methodology.map(note => <Typography variant="body2" key={note}>{note}</Typography>)}
      <Typography variant="caption">{workspace.updatedAt ? `Portfolio last saved ${workspace.updatedAt}.` : 'No saved portfolio yet.'}</Typography>
    </Stack></AccordionDetails></Accordion>

    <Dialog open={holdingForm !== null} onClose={() => { if (!busy) setHoldingForm(null); }} fullWidth maxWidth="sm">
      <DialogTitle>{workspace.data.holdings.some(holding => holding.id === holdingForm?.id) ? 'Edit holding' : 'Add holding'}</DialogTitle>
      <DialogContent>{formAlert}{holdingForm && <Stack spacing={2} sx={{ pt: 1 }}>
        <TextField select label="Investment account" value={holdingForm.accountId} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, accountId: event.target.value })}>{data.accounts.map(account => <MenuItem key={account.id} value={String(account.id)}>{account.name}</MenuItem>)}</TextField>
        <TextField label="Holding name" value={holdingForm.name} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, name: event.target.value })} helperText="Copy the fund or asset name from your statement." />
        <TextField select label="Asset class" value={holdingForm.assetClass} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, assetClass: event.target.value as AssetClass })}>{ASSET_CLASSES.map(assetClass => <MenuItem key={assetClass} value={assetClass}>{ASSET_CLASS_LABELS[assetClass]}</MenuItem>)}</TextField>
        <TextField label="Recorded value (£ GBP)" value={holdingForm.value} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, value: event.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} helperText="Part of the existing account balance; no live prices or extra net-worth asset." />
        <TextField label="Statement valuation date" type="date" value={holdingForm.valuationDate} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, valuationDate: event.target.value })} slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: londonTodayIso() } }} />
        <TextField label="Annual holding fee (%)" value={holdingForm.feeRate} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, feeRate: event.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} helperText="Leave blank if unknown. Exclude the separate platform fee; 0 means confirmed zero." />
        <TextField label="Fund provider (optional)" value={holdingForm.provider} disabled={busy} onChange={event => setHoldingForm({ ...holdingForm, provider: event.target.value })} />
      </Stack>}</DialogContent>
      <DialogActions><Button disabled={busy} onClick={() => setHoldingForm(null)}>Cancel</Button><Button disabled={busy} variant="contained" onClick={() => void saveHolding()}>{busy ? 'Saving…' : 'Save holding'}</Button></DialogActions>
    </Dialog>
    <Dialog open={platformForm !== null} onClose={() => { if (!busy) setPlatformForm(null); }} fullWidth maxWidth="sm">
      <DialogTitle>Annual platform fee</DialogTitle><DialogContent>{formAlert}{platformForm && <Stack spacing={2} sx={{ pt: 1 }}>
        <Typography>{data.accounts.find(account => account.id === platformForm.accountId)?.name}</Typography>
        <TextField label="Annual platform fee (%)" value={platformForm.feeRate} disabled={busy} onChange={event => setPlatformForm({ ...platformForm, feeRate: event.target.value })} slotProps={{ htmlInput: { inputMode: 'decimal' } }} helperText="Leave blank when unknown. Enter only the additional account percentage charge, separate from holding fees." />
        <Typography variant="body2">The estimate uses the account’s positive ledger balance. It excludes fixed fees, tiering, caps, rebates and transaction costs. Check the provider’s actual charges before comparing accounts.</Typography>
      </Stack>}</DialogContent><DialogActions><Button disabled={busy} onClick={() => setPlatformForm(null)}>Cancel</Button><Button variant="contained" disabled={busy} onClick={() => void savePlatform()}>{busy ? 'Saving…' : 'Save platform fee'}</Button></DialogActions>
    </Dialog>
    <Dialog open={removeId !== null || removeOrphans} onClose={() => { if (!busy) { setRemoveId(null); setRemoveOrphans(false); } }} fullWidth maxWidth="xs"><DialogTitle>{removeOrphans ? 'Remove unlinked records?' : 'Remove this holding?'}</DialogTitle><DialogContent>{formAlert}<Typography>{removeOrphans ? 'Remove all holdings and platform fees whose investment accounts are missing.' : `Remove ${workspace.data.holdings.find(holding => holding.id === removeId)?.name} from the portfolio records.`} Account balances remain unchanged.</Typography></DialogContent><DialogActions><Button disabled={busy} onClick={() => { setRemoveId(null); setRemoveOrphans(false); }}>Cancel</Button><Button disabled={busy} variant="contained" onClick={() => void removeHolding()}>{busy ? 'Removing…' : removeOrphans ? 'Remove unlinked records' : 'Remove holding'}</Button></DialogActions></Dialog>
  </Stack>;
}
