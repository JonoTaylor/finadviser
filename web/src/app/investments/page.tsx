'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Stack, Table, TableHead,
  TableRow, TableCell, TableBody, TableContainer, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Snackbar, Alert,
  Grid, Skeleton, Tooltip,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { fetchJson } from '@/lib/http/client';
import Link from 'next/link';
import Decimal from 'decimal.js';
import PageHeader from '@/components/ui/PageHeader';
import MetricCard from '@/components/ui/MetricCard';

interface Investment {
  id: number;
  name: string;
  investmentKind: string | null;
  ownerId: number | null;
  ownerName: string | null;
  balance: string;
  balanceAsOf: string;
}

interface OwnerLite { id: number; name: string }

const KINDS = [
  { value: 'pension', label: 'Pension' },
  { value: 'isa', label: 'S&S ISA' },
  { value: 'lisa', label: 'LISA' },
  { value: 'savings', label: 'Cash savings' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'other', label: 'Other' },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(KINDS.map(k => [k.value, k.label]));

const fetcher = fetchJson;

export default function InvestmentsPage() {
  const { data: investments, error, mutate, isLoading } = useSWR<Investment[]>('/api/investments', fetcher, { shouldRetryOnError: false });
  const { data: owners, error: ownersError, isLoading: ownersLoading } = useSWR<OwnerLite[]>('/api/owners', fetcher, { shouldRetryOnError: false });

  const [addOpen, setAddOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<Investment | null>(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const list = investments ?? [];

  return (
    <Box sx={{ maxWidth: 1440, mx: 'auto' }}>
      <PageHeader title="Investment accounts" description="Recorded pension, ISA and savings balances across your household."
        actions={<Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)} disabled={Boolean(error || ownersError || isLoading || ownersLoading)}>
            Add investment
          </Button>} />

      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 3 }}><Button component={Link} href="/portfolio" variant="outlined">Holdings &amp; fees</Button><Button component={Link} href="/plan" variant="outlined">Financial plan</Button><Button component={Link} href="/pensions" variant="outlined">Retirement planner</Button></Stack>
      {error && <Alert severity="warning" action={<Button color="inherit" size="small" onClick={() => void mutate()}>Retry</Button>} sx={{ mb: 3 }}>Your investment balances could not be loaded. No zero balances have been substituted.</Alert>}
      {ownersError && <Alert severity="warning" sx={{ mb: 3 }}>Account owners could not be loaded. Reconnect your accounts before adding an investment.</Alert>}
      {investments && <Box sx={{ mb: 3 }}><Grid container spacing={2}>{[
        { label: 'Total tracked account balances', amount: list.reduce((sum, item) => sum.plus(item.balance), new Decimal(0)), detail: `${list.length} recorded accounts · household` },
        { label: 'Pensions', amount: list.filter(item => item.investmentKind === 'pension').reduce((sum, item) => sum.plus(item.balance), new Decimal(0)) },
        { label: 'Cash savings', amount: list.filter(item => item.investmentKind === 'savings').reduce((sum, item) => sum.plus(item.balance), new Decimal(0)) },
      ].map(item => <Grid key={item.label} size={{ xs: 12, sm: 4 }}><MetricCard label={item.label} value={formatCurrency(item.amount)} detail={item.detail ?? (item.label === 'Pensions' ? 'Excluded from emergency cash' : 'Confirm access in My context')} /></Grid>)}</Grid><Typography variant="caption" sx={{ display: 'block', mt: 1.5 }}>Whole household · as of {list[0]?.balanceAsOf ?? londonTodayIso()} · recorded balances, not live market prices. Pension balances are not accessible emergency cash.</Typography></Box>}

      <Card>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" gap={1} sx={{ mb: 2 }}><Typography variant="h6">Tracked accounts</Typography>{investments && <Chip size="small" label={`${list.length} accounts`} />}</Stack>
          {isLoading ? (
            <Skeleton variant="rectangular" height={120} />
          ) : error ? <Typography variant="body2">Reconnect your accounts and retry to see your investments.</Typography> : list.length === 0 ? (
            <Box sx={{ py: 3, textAlign: 'center' }}><Typography variant="h6">No investment accounts recorded</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Add a pension, ISA or savings account and enter its recorded balance.</Typography></Box>
          ) : (
            <TableContainer tabIndex={0} role="region" aria-label="Investment accounts table" sx={{ maxWidth: '100%' }}><Table size="small" aria-label="Tracked investment account balances" sx={{ minWidth: 650 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell align="right">Balance</TableCell>
                  <TableCell align="right">Actions</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell><Typography variant="body2" fontWeight={600}>{inv.name}</Typography><Typography variant="caption">Recorded as of {inv.balanceAsOf}</Typography></TableCell>
                    <TableCell>
                      {inv.investmentKind ? (
                        <Chip size="small" label={KIND_LABEL[inv.investmentKind] ?? inv.investmentKind} variant="outlined" />
                      ) : 'Not recorded'}
                    </TableCell>
                    <TableCell>{inv.ownerName ?? 'Not recorded'}</TableCell>
                    <TableCell align="right" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{formatCurrency(inv.balance)}</TableCell>
                    <TableCell align="right">
                      <Tooltip title="Update recorded balance"><IconButton size="small" onClick={() => setUpdateTarget(inv)} aria-label={`Update balance of ${inv.name}`}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton></Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table></TableContainer>
          )}
        </CardContent>
      </Card>

      <AddInvestmentDialog
        open={addOpen}
        owners={owners ?? []}
        onClose={() => setAddOpen(false)}
        onCreated={() => {
          setAddOpen(false);
          mutate();
          setSnack({ open: true, severity: 'success', message: 'Investment added.' });
        }}
        onError={(message) => setSnack({ open: true, severity: 'error', message })}
      />
      <UpdateBalanceDialog
        target={updateTarget}
        onClose={() => setUpdateTarget(null)}
        onUpdated={(delta) => {
          setUpdateTarget(null);
          mutate();
          setSnack({
            open: true,
            severity: 'success',
            message: parseFloat(delta) === 0
              ? 'Balance unchanged.'
              : `Balance updated. ${parseFloat(delta) > 0 ? '+' : ''}${formatCurrency(delta)}.`,
          });
        }}
        onError={(message) => setSnack({ open: true, severity: 'error', message })}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function AddInvestmentDialog({
  open, owners, onClose, onCreated, onError,
}: {
  open: boolean;
  owners: OwnerLite[];
  onClose: () => void;
  onCreated: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState('pension');
  const [ownerId, setOwnerId] = useState<number | ''>('');
  const [initialBalance, setInitialBalance] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const reset = () => { setName(''); setKind('pension'); setOwnerId(''); setInitialBalance(''); };

  const handleSubmit = async () => {
    if (!name.trim() || ownerId === '') return;
    setSubmitting(true);
    try {
      const createRes = await fetch('/api/investments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), investmentKind: kind, ownerId }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${createRes.status}`);
      }
      const created = await createRes.json();

      if (initialBalance && /^\d+(\.\d+)?$/.test(initialBalance)) {
        const balRes = await fetch(`/api/investments/${created.id}/balance`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ newBalance: initialBalance }),
        });
        if (!balRes.ok) {
          const body = await balRes.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${balRes.status}`);
        }
      }
      reset();
      onCreated();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to create investment');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => { if (!submitting) onClose(); }} disableEscapeKeyDown={submitting} maxWidth="sm" fullWidth aria-labelledby="add-investment-title">
      <DialogTitle id="add-investment-title">Add investment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            placeholder="Vanguard SIPP"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            fullWidth
            disabled={submitting}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <TextField
              select
              label="Type"
              value={kind}
              onChange={e => setKind(e.target.value)}
              fullWidth
              disabled={submitting}
            >
              {KINDS.map(k => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Owner"
              value={ownerId}
              onChange={e => setOwnerId(e.target.value === '' ? '' : Number(e.target.value))}
              fullWidth
              required
              disabled={submitting}
              helperText="Choose the person who owns this account."
            >
              <MenuItem value="">Choose an owner</MenuItem>
              {owners.map(o => <MenuItem key={o.id} value={o.id}>{o.name}</MenuItem>)}
            </TextField>
          </Stack>
          <TextField
            label="Current balance (£)"
            type="number"
            value={initialBalance}
            onChange={e => setInitialBalance(e.target.value)}
            helperText="Optional — you can also update it later"
            fullWidth
            disabled={submitting}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || !name.trim() || ownerId === ''}>
          {submitting ? 'Saving…' : 'Add'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function UpdateBalanceDialog({
  target, onClose, onUpdated, onError,
}: {
  target: Investment | null;
  onClose: () => void;
  onUpdated: (delta: string) => void;
  onError: (message: string) => void;
}) {
  const [newBalance, setNewBalance] = useState('');
  const [asOfDate, setAsOfDate] = useState(londonTodayIso());
  const [submitting, setSubmitting] = useState(false);
  const [prevTargetId, setPrevTargetId] = useState<number | null>(null);

  // Reset form when the dialog target changes (using "adjust state during
  // render" rather than useEffect, per React 19 idiom).
  //
  // Normalise to `number | null` on both sides — `target?.id` returns
  // `undefined` when target is null, and `undefined !== null`, which
  // would fire setState on every render and crash the page with
  // "Too many re-renders" (caught at prerender time on Vercel).
  const targetId: number | null = target?.id ?? null;
  if (targetId !== prevTargetId) {
    setPrevTargetId(targetId);
    setNewBalance(target?.balance ?? '');
    setAsOfDate(londonTodayIso());
  }

  const handleSubmit = async () => {
    if (!target || !newBalance) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/investments/${target.id}/balance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newBalance: newBalance.trim(), asOfDate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json();
      onUpdated(data.delta);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Failed to update balance');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={target !== null} onClose={() => { if (!submitting) onClose(); }} disableEscapeKeyDown={submitting} maxWidth="xs" fullWidth aria-labelledby="update-investment-balance-title">
      <DialogTitle id="update-investment-balance-title">Update balance — {target?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="New balance (£)"
            type="number"
            value={newBalance}
            onChange={e => setNewBalance(e.target.value)}
            required
            fullWidth
            disabled={submitting}
            helperText={target ? `Current: ${formatCurrency(target.balance)}` : ''}
          />
          <TextField
            label="As of"
            type="date"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
            disabled={submitting}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit} disabled={submitting || !newBalance}>
          {submitting ? 'Saving…' : 'Update'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
