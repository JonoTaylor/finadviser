'use client';

import { useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  Button, TextField, Stack, MenuItem, Select, InputLabel, FormControl,
} from '@mui/material';

interface Mortgage {
  id: number;
  lender: string;
}

interface OwnershipRow {
  owner_id: number;
  owner_name: string;
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
  onSave: (data: Record<string, unknown>) => void;
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
    fromAccountId: '1', // Default to bank account (id=1)
  });

  const handleSave = () => {
    onSave({
      mortgageId: parseInt(form.mortgageId),
      paymentDate: form.paymentDate,
      totalAmount: form.totalAmount,
      principalAmount: form.principalAmount,
      interestAmount: form.interestAmount,
      payerOwnerId: parseInt(form.payerOwnerId),
      fromAccountId: parseInt(form.fromAccountId),
    });
    setForm({ mortgageId: '', paymentDate: '', totalAmount: '', principalAmount: '', interestAmount: '', payerOwnerId: '', fromAccountId: '1' });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Record Mortgage Payment</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl fullWidth>
            <InputLabel>Mortgage</InputLabel>
            <Select value={form.mortgageId} label="Mortgage" onChange={e => setForm({ ...form, mortgageId: e.target.value })}>
              {mortgages.map(m => <MenuItem key={m.id} value={String(m.id)}>{m.lender}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl fullWidth>
            <InputLabel>Payer</InputLabel>
            <Select value={form.payerOwnerId} label="Payer" onChange={e => setForm({ ...form, payerOwnerId: e.target.value })}>
              {ownership.map((o) => <MenuItem key={o.owner_id} value={String(o.owner_id)}>{o.owner_name}</MenuItem>)}
            </Select>
          </FormControl>
          <TextField label="Payment Date" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.paymentDate} onChange={e => setForm({ ...form, paymentDate: e.target.value })} />
          <TextField label="Total Amount" type="number" value={form.totalAmount} onChange={e => setForm({ ...form, totalAmount: e.target.value })} />
          <TextField label="Principal Amount" type="number" value={form.principalAmount} onChange={e => setForm({ ...form, principalAmount: e.target.value })} />
          <TextField label="Interest Amount" type="number" value={form.interestAmount} onChange={e => setForm({ ...form, interestAmount: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave}>Record</Button>
      </DialogActions>
    </Dialog>
  );
}
