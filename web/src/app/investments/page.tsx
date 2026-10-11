'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Stack, Table, TableHead,
  TableRow, TableCell, TableBody, Chip, IconButton, Dialog, DialogTitle,
  DialogContent, DialogActions, TextField, MenuItem, Snackbar, Alert,
  Skeleton,
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { fetchJson } from '@/lib/http/client';
import Link from 'next/link';
import Decimal from 'decimal.js';

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
  const { data: owners, error: ownersError } = useSWR<OwnerLite[]>('/api/owners', fetcher, { shouldRetryOnError: false });

  const [addOpen, setAddOpen] = useState(false);
  const [updateTarget, setUpdateTarget] = useState<Investment | null>(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const list = investments ?? [];

  return (
    <Box>
      <Box sx={{ mb: 3 }}>
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
          <Box>
            <Typography variant="h4">Investments</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Track your pension, ISA and savings balances in one place. Review the holdings,
              risk and fees behind each account as well as its value.
            </Typography>
          </Box>
          <Button variant="contained" startIcon={<AddRoundedIcon />} onClick={() => setAddOpen(true)} disabled={Boolean(error || ownersError)}>
            Add investment
          </Button>
        </Stack>
      </Box>

      <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 3 }}><Button component={Link} href="/portfolio" variant="contained">Holdings, allocation &amp; fees</Button><Button component={Link} href="/plan" variant="outlined">Review my wealth plan</Button><Button component={Link} href="/pensions" variant="outlined">Model my retirement</Button></Stack>
      {error && <Alert severity="warning" sx={{ mb: 3 }}>Your investment balances could not be loaded. No zero balances have been substituted.</Alert>}
      {ownersError && <Alert severity="warning" sx={{ mb: 3 }}>Account owners could not be loaded. Reconnect your accounts before adding an investment.</Alert>}
      {investments && <Card sx={{ mb: 3 }}><CardContent><Stack direction={{ xs: 'column', sm: 'row' }} gap={4}>{[
        { label: 'Total tracked investments', amount: list.reduce((sum, item) => sum.plus(item.balance), new Decimal(0)) },
        { label: 'Pensions', amount: list.filter(item => item.investmentKind === 'pension').reduce((sum, item) => sum.plus(item.balance), new Decimal(0)) },
        { label: 'Cash savings', amount: list.filter(item => item.investmentKind === 'savings').reduce((sum, item) => sum.plus(item.balance), new Decimal(0)) },
      ].map(item => <Box key={item.label}><Typography variant="caption">{item.label}</Typography><Typography variant="h5" sx={{ mt: 1 }}>{formatCurrency(item.amount)}</Typography></Box>)}</Stack><Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Whole household · as of {list[0]?.balanceAsOf ?? londonTodayIso()} · recorded balances, not live market prices. Pension balances are not accessible emergency cash.</Typography></CardContent></Card>}

      <Card>
        <CardContent>
          {isLoading ? (
            <Skeleton variant="rectangular" height={120} />
          ) : error ? <Typography variant="body2">Reconnect your accounts and retry to see your investments.</Typography> : list.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No investments tracked yet. Click <strong>Add investment</strong> to track a pension,
              ISA, or savings pot. The AI assistant can do this for you in chat too — try
              &ldquo;Add my Vanguard pension at £150,000, owned by me&rdquo;.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Type</TableCell>
                  <TableCell>Owner</TableCell>
                  <TableCell align="right">Balance</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {list.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell>{inv.name}</TableCell>
                    <TableCell>
                      {inv.investmentKind ? (
                        <Chip size="small" label={KIND_LABEL[inv.investmentKind] ?? inv.investmentKind} variant="outlined" />
                      ) : '—'}
                    </TableCell>
                    <TableCell>{inv.ownerName ?? '—'}</TableCell>
                    <TableCell align="right">{formatCurrency(inv.balance)}</TableCell>
                    <TableCell align="right">
                      <IconButton size="small" onClick={() => setUpdateTarget(inv)} aria-label={`Update balance of ${inv.name}`}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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

  // owners loads asynchronously via SWR. The first render sees
  // an empty array; the second (after owners arrives) needs to
  // fill in the default ownerId so the user isn't forced to pick
  // every time. "Adjust state during render" idiom rather than
  // useEffect to avoid an extra render flash.
  const firstOwnerId = owners[0]?.id;
  if (ownerId === '' && firstOwnerId !== undefined) {
    setOwnerId(firstOwnerId);
  }

  const reset = () => { setName(''); setKind('pension'); setOwnerId(firstOwnerId ?? ''); setInitialBalance(''); };

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
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add investment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="Name"
            placeholder="Vanguard SIPP"
            value={name}
            onChange={e => setName(e.target.value)}
            required
            fullWidth
          />
          <Stack direction="row" spacing={2}>
            <TextField
              select
              label="Type"
              value={kind}
              onChange={e => setKind(e.target.value)}
              fullWidth
            >
              {KINDS.map(k => <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>)}
            </TextField>
            <TextField
              select
              label="Owner"
              value={ownerId}
              onChange={e => setOwnerId(Number(e.target.value))}
              fullWidth
              required
            >
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
    <Dialog open={target !== null} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Update balance — {target?.name}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            label="New balance (£)"
            type="number"
            value={newBalance}
            onChange={e => setNewBalance(e.target.value)}
            required
            fullWidth
            helperText={target ? `Current: ${formatCurrency(target.balance)}` : ''}
          />
          <TextField
            label="As of"
            type="date"
            value={asOfDate}
            onChange={e => setAsOfDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            fullWidth
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
