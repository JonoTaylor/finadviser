'use client';

import { useState } from 'react';
import { Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack } from '@mui/material';

export default function AddPropertyDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { name: string; address: string; purchaseDate: string; purchasePrice: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ name: '', address: '', purchaseDate: '', purchasePrice: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!form.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave({ ...form, name: form.name.trim() });
      setForm({ name: '', address: '', purchaseDate: '', purchasePrice: '' });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'The property could not be saved. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={() => { if (!saving) onClose(); }} maxWidth="sm" fullWidth>
      <DialogTitle>Add Property</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <TextField label="Name" required disabled={saving} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <TextField label="Address" disabled={saving} value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
          <TextField label="Purchase Date" type="date" disabled={saving} slotProps={{ inputLabel: { shrink: true } }} value={form.purchaseDate} onChange={e => setForm({ ...form, purchaseDate: e.target.value })} />
          <TextField label="Purchase Price" type="number" disabled={saving} value={form.purchasePrice} onChange={e => setForm({ ...form, purchasePrice: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="contained" onClick={() => void handleSave()} disabled={!form.name.trim() || saving}>{saving ? 'Saving…' : 'Add'}</Button>
      </DialogActions>
    </Dialog>
  );
}
