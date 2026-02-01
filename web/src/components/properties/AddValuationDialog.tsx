'use client';

import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack } from '@mui/material';

export default function AddValuationDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { valuation: string; valuationDate: string; source: string }) => void;
}) {
  const [form, setForm] = useState({ valuation: '', valuationDate: '', source: 'manual' });

  const handleSave = () => {
    if (!form.valuation || !form.valuationDate) return;
    onSave(form);
    setForm({ valuation: '', valuationDate: '', source: 'manual' });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Valuation</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Valuation Amount" type="number" required value={form.valuation} onChange={e => setForm({ ...form, valuation: e.target.value })} />
          <TextField label="Date" type="date" required slotProps={{ inputLabel: { shrink: true } }} value={form.valuationDate} onChange={e => setForm({ ...form, valuationDate: e.target.value })} />
          <TextField label="Source" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!form.valuation || !form.valuationDate}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}
