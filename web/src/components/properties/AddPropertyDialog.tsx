'use client';

import { useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack } from '@mui/material';

export default function AddPropertyDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; address: string; purchaseDate: string; purchasePrice: string }) => void;
}) {
  const [form, setForm] = useState({ name: '', address: '', purchaseDate: '', purchasePrice: '' });

  const handleSave = () => {
    if (!form.name) return;
    onSave(form);
    setForm({ name: '', address: '', purchaseDate: '', purchasePrice: '' });
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Add Property</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField label="Name" required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <TextField label="Address" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          <TextField label="Purchase Date" type="date" slotProps={{ inputLabel: { shrink: true } }} value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} />
          <TextField label="Purchase Price" type="number" value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={!form.name}>Add</Button>
      </DialogActions>
    </Dialog>
  );
}
