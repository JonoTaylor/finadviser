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

interface Account {
  id: number;
  name: string;
  account_type: string;
}

interface Tenancy {
  id: number;
  tenantName: string;
  startDate: string;
  endDate: string | null;
  rentAmount: string;
}

const fetcher = (url: string) => fetch(url).then(r => r.json());

function activeTenancyOn(tenancies: Tenancy[], isoDate: string): Tenancy | null {
  return (
    tenancies
      .filter(t => t.startDate <= isoDate && (!t.endDate || t.endDate >= isoDate))
      .sort((a, b) => (a.startDate < b.startDate ? 1 : -1))[0] ?? null
  );
}

const todayIso = () => new Date().toISOString().slice(0, 10);

export default function RecordRentDialog({
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
  // Reset on open transition (React 19 idiom: adjust state during render).
  const [prevOpen, setPrevOpen] = useState(open);
  const [date, setDate] = useState(todayIso);
  const [amountInput, setAmountInput] = useState<string | null>(null);
  const [tenancyOverride, setTenancyOverride] = useState<number | '' | null>(null);
  const [toAccountId, setToAccountId] = useState<number | ''>('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setDate(todayIso());
      setAmountInput(null);
      setTenancyOverride(null);
      setToAccountId('');
      setDescription('');
      setError(null);
      setSubmitting(false);
    }
  }

  const { data: assetAccounts } = useSWR<Account[]>('/api/accounts?type=ASSET', fetcher);
  const { data: tenancies } = useSWR<Tenancy[]>(
    open ? `/api/properties/${propertyId}/tenancies` : null,
    fetcher,
  );

  const activeTenancy = tenancies ? activeTenancyOn(tenancies, date) : null;

  // Derived: tenancy defaults to active-on-date until user picks one.
  const tenancyId: number | '' =
    tenancyOverride !== null ? tenancyOverride : (activeTenancy?.id ?? '');
  const selectedTenancy = tenancies?.find(t => t.id === tenancyId) ?? null;

  // Derived: amount defaults to selected tenancy's rent until user types.
  const amount = amountInput !== null ? amountInput : (selectedTenancy?.rentAmount ?? '');

  const valid = date && amount && toAccountId !== '';

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/rental-income`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          date,
          amount,
          toAccountId,
          description: description || undefined,
          tenancyId: tenancyId || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to record rental income');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record rent received</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Date received"
            type="date"
            required
            slotProps={{ inputLabel: { shrink: true } }}
            value={date}
            onChange={e => setDate(e.target.value)}
          />

          {tenancies && tenancies.length > 0 && (
            <TextField
              select
              label="Tenancy"
              value={tenancyId}
              onChange={e => {
                const v = e.target.value;
                setTenancyOverride(v === '' ? '' : Number(v));
              }}
              helperText={
                activeTenancy
                  ? `Active on ${date}: ${activeTenancy.tenantName}`
                  : 'No tenancy active on this date'
              }
            >
              <MenuItem value="">— None —</MenuItem>
              {tenancies.map(t => (
                <MenuItem key={t.id} value={t.id}>
                  {t.tenantName} ({t.startDate} → {t.endDate ?? 'ongoing'})
                </MenuItem>
              ))}
            </TextField>
          )}

          <TextField
            label="Amount received (gross, £)"
            type="number"
            required
            value={amount}
            onChange={e => setAmountInput(e.target.value)}
            helperText="Gross rent paid by tenant. If a letting agent later deducts a fee, record the fee as a separate expense."
          />

          <TextField
            select
            label="Received into account"
            required
            value={toAccountId}
            onChange={e => setToAccountId(Number(e.target.value))}
            helperText={
              assetAccounts && assetAccounts.length === 0
                ? 'No asset accounts found. Create one (e.g. \'Emily — current account\') first.'
                : "Choose the bank account that received the rent (e.g. Emily's current account)."
            }
          >
            {(assetAccounts ?? []).map(a => (
              <MenuItem key={a.id} value={a.id}>
                {a.name}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            label="Description (optional)"
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Defaults to 'Rent received - <tenant>'"
          />

          <Typography variant="caption" color="text.secondary">
            Records gross rent against the property. The 50/50 tax split is applied automatically when you switch to a per-owner view on the tax-year report.
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
