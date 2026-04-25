'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Stack,
  MenuItem,
  Alert,
  Typography,
} from '@mui/material';
import { londonTodayIso } from '@/lib/dates/today';

interface Account { id: number; name: string; account_type: string }
interface Category { id: number; name: string }

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function AddExpenseDialog({
  open,
  propertyId,
  onClose,
  onSaved,
}: {
  open: boolean;
  propertyId: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [prevOpen, setPrevOpen] = useState(open);
  const [date, setDate] = useState(londonTodayIso);
  const [amount, setAmount] = useState('');
  const [categoryId, setCategoryId] = useState<number | ''>('');
  const [fromAccountId, setFromAccountId] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDate(londonTodayIso());
      setAmount('');
      setCategoryId('');
      setFromAccountId('');
      setDescription('');
      setReference('');
      setError(null);
      setSubmitting(false);
    }
  }

  const { data: assetAccounts } = useSWR<Account[]>(
    open ? '/api/accounts?type=ASSET' : null,
    fetcher,
  );
  const { data: categories } = useSWR<Category[]>(
    open ? '/api/categories?parent=Property%20expenses' : null,
    fetcher,
  );

  // Disable submit on non-numeric or non-positive amounts so the server's
  // ClientError path doesn't have to catch obvious user-input mistakes.
  const parsedAmount = parseFloat(amount);
  const validAmount = amount !== '' && Number.isFinite(parsedAmount) && parsedAmount > 0;
  const valid = Boolean(date) && validAmount && fromAccountId !== '';

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/expenses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          amount,
          fromAccountId,
          categoryId: categoryId || undefined,
          description: description || undefined,
          reference: reference || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record expense');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record property expense</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Date paid"
            type="date"
            required
            slotProps={{ inputLabel: { shrink: true } }}
            value={date}
            onChange={e => setDate(e.target.value)}
          />

          <TextField
            label="Amount (£)"
            type="number"
            required
            value={amount}
            onChange={e => setAmount(e.target.value)}
            helperText="Enter the gross amount paid; the 50/50 share is applied at report time."
          />

          <TextField
            select
            label="Category"
            value={categoryId}
            onChange={e => setCategoryId(e.target.value === '' ? '' : Number(e.target.value))}
            helperText={
              categories && categories.length === 0
                ? 'No property expense categories seeded yet — re-run the build migration.'
                : 'Itemised UK BTL deductible categories. Mortgage interest is recorded separately.'
            }
          >
            <MenuItem value="">— Uncategorised —</MenuItem>
            {(categories ?? []).map(c => (
              <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>
            ))}
          </TextField>

          <TextField
            select
            label="Paid from"
            required
            value={fromAccountId}
            onChange={e => setFromAccountId(Number(e.target.value))}
            helperText="The bank/asset account that paid the expense."
          >
            {(assetAccounts ?? []).map(a => (
              <MenuItem key={a.id} value={a.id}>{a.name}</MenuItem>
            ))}
          </TextField>

          <TextField
            label="Description"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. 'Boiler service - British Gas'"
          />

          <TextField
            label="Reference (optional)"
            value={reference}
            onChange={e => setReference(e.target.value)}
            placeholder="e.g. invoice number"
          />

          <Typography variant="caption" color="text.secondary">
            Recorded against the property and shown on the tax-year report&apos;s
            {' '}&ldquo;Itemised deductible expenses&rdquo; section. The owner toggle on the report applies the share.
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!valid || submitting} onClick={handleSave}>
          {submitting ? 'Saving…' : 'Record'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
