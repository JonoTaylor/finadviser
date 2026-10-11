'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import useSWR from 'swr';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Alert, Box, Button, TextField, Stack, MenuItem, Select, InputLabel, FormControl,
} from '@mui/material';
import { fetchJson } from '@/lib/http/client';

interface Mortgage {
  id: number;
  lender: string;
}

interface OwnershipRow {
  owner_id: number;
  owner_name: string;
}

interface PaymentAccount { id: number; name: string; accountType: string }

async function loadPaymentAccounts(url: string): Promise<PaymentAccount[]> {
  const accounts = await fetchJson<unknown>(url);
  if (!Array.isArray(accounts) || accounts.some(account => !account || !Number.isInteger(account.id) || account.id <= 0 || typeof account.name !== 'string' || typeof account.accountType !== 'string')) {
    throw new Error('The payment account list could not be read. Please retry.');
  }
  return accounts as PaymentAccount[];
}

export default function RecordPaymentDialog({
  open,
  onClose,
  onSave,
  mortgages,
  ownership,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  mortgages: Mortgage[];
  ownership: OwnershipRow[];
}) {
  const [form, setForm] = useState({
    mortgageId: '',
    paymentDate: '',
    totalAmount: '',
    principalAmount: '',
    interestAmount: '',
    payerOwnerId: '',
    fromAccountId: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const writing = useRef(false);
  useEffect(() => { if (open) setError(''); }, [open]);
  const { data: accounts, error: accountsError, isLoading: accountsLoading, isValidating: accountsRefreshing, mutate: reloadAccounts } = useSWR<PaymentAccount[]>(open ? '/api/accounts' : null, loadPaymentAccounts, {
    shouldRetryOnError: false,
    revalidateOnFocus: false,
  });
  const accountsReady = Boolean(accounts && !accountsError && !accountsLoading);
  const selectedAccount = accounts?.find(account => String(account.id) === form.fromAccountId);
  const fieldsComplete = [form.mortgageId, form.payerOwnerId, form.paymentDate, form.totalAmount, form.principalAmount, form.interestAmount].every(value => value.trim() !== '');

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (writing.current) return;
    if (!accountsReady || !selectedAccount) {
      setError('Choose the account that paid this mortgage before recording the payment.');
      return;
    }
    if (!fieldsComplete) {
      setError('Choose a mortgage and payer, then complete the payment date and all three amounts.');
      return;
    }
    writing.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave({
        mortgageId: parseInt(form.mortgageId),
        paymentDate: form.paymentDate,
        totalAmount: form.totalAmount,
        principalAmount: form.principalAmount,
        interestAmount: form.interestAmount,
        payerOwnerId: parseInt(form.payerOwnerId),
        fromAccountId: parseInt(form.fromAccountId),
      });
      setForm({ mortgageId: '', paymentDate: '', totalAmount: '', principalAmount: '', interestAmount: '', payerOwnerId: '', fromAccountId: '' });
      onClose();
    } catch (caught) {
      const detail = caught instanceof Error ? caught.message : 'No save confirmation was received.';
      setError(`The payment save could not be confirmed. Your entries are kept. Check recorded payments before retrying. ${detail}`);
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const close = () => {
    if (!writing.current) onClose();
  };

  return (
    <Dialog open={open} onClose={close} disableEscapeKeyDown={busy} maxWidth="sm" fullWidth>
      <Box component="form" onSubmit={handleSave} noValidate>
      <DialogTitle>Record Mortgage Payment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          {accountsError && <Alert severity="error" action={<Button disabled={busy || accountsRefreshing} color="inherit" onClick={() => void reloadAccounts().catch(() => undefined)}>Retry accounts</Button>}>{accountsError instanceof Error ? accountsError.message : 'Payment accounts are unavailable.'}</Alert>}
          {accountsReady && accounts?.length === 0 && <Alert severity="info">No payment accounts are available. Add the account that made this payment before recording it.</Alert>}
          <FormControl fullWidth required disabled={busy}>
            <InputLabel id="mortgage-payment-mortgage-label">Mortgage</InputLabel>
            <Select required labelId="mortgage-payment-mortgage-label" value={form.mortgageId} label="Mortgage" onChange={e => setForm({ ...form, mortgageId: e.target.value })}>
              {mortgages.map(m => <MenuItem key={m.id} value={String(m.id)}>{m.lender}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField select required disabled={busy || !accountsReady} label="Paid from" value={form.fromAccountId} onChange={e => setForm({ ...form, fromAccountId: e.target.value })} helperText={accountsLoading ? 'Loading payment accounts…' : 'Select the account that made this mortgage payment.'}>
            {(accounts ?? []).map(account => <MenuItem key={account.id} value={String(account.id)}>{account.name} ({account.accountType.toLowerCase()})</MenuItem>)}
          </TextField>
          <FormControl fullWidth required disabled={busy}>
            <InputLabel id="mortgage-payment-payer-label">Payer</InputLabel>
            <Select required labelId="mortgage-payment-payer-label" value={form.payerOwnerId} label="Payer" onChange={e => setForm({ ...form, payerOwnerId: e.target.value })}>
              {ownership.map((o) => <MenuItem key={o.owner_id} value={String(o.owner_id)}>{o.owner_name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField required disabled={busy} label="Payment Date" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
          <TextField required disabled={busy} label="Total Amount" type="number" slotProps={{ htmlInput: { step: 'any' } }} value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
          <TextField required disabled={busy} label="Principal Amount" type="number" slotProps={{ htmlInput: { step: 'any' } }} value={form.principalAmount} onChange={e => setForm({ ...form, principalAmount: e.target.value })} />
          <TextField required disabled={busy} label="Interest Amount" type="number" slotProps={{ htmlInput: { step: 'any' } }} value={form.interestAmount} onChange={e => setForm({ ...form, interestAmount: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={close}>Cancel</Button>
        <Button disabled={busy || !accountsReady || !selectedAccount || !fieldsComplete} variant="contained" type="submit">{busy ? 'Recording…' : 'Record'}</Button>
      </DialogActions>
      </Box>
    </Dialog>
  );
}
