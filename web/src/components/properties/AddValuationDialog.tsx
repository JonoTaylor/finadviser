'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Alert, Box, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, Stack } from '@mui/material';

export default function AddValuationDialog({
  open,
  onClose,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  onSave: (data: { valuation: string; valuationDate: string; source: string }) => Promise<void>;
}) {
  const [form, setForm] = useState({ valuation: '', valuationDate: '', source: 'manual' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  useEffect(() => { if (open) setError(''); }, [open]);

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    if (saving.current || !form.valuation || !form.valuationDate) return;
    saving.current = true;
    setBusy(true);
    setError('');
    try {
      await onSave(form);
      setForm({ valuation: '', valuationDate: '', source: 'manual' });
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The valuation could not be saved.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const handleClose = () => { if (!saving.current) { setError(''); onClose(); } };

  return (
    <Dialog open={open} onClose={handleClose} disableEscapeKeyDown={busy} maxWidth="sm" fullWidth>
      <Box component="form" onSubmit={handleSave}>
      <DialogTitle>Add Valuation</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity="error">{error} Your entries are still here.</Alert>}
          <TextField label="Valuation Amount" type="number" required disabled={busy} value={form.valuation} onChange={e => setForm({ ...form, valuation: e.target.value })} slotProps={{ htmlInput: { step: 'any' } }} />
          <TextField label="Date" type="date" required disabled={busy} slotProps={{ inputLabel: { shrink: true } }} value={form.valuationDate} onChange={e => setForm({ ...form, valuationDate: e.target.value })} />
          <TextField label="Source" disabled={busy} value={form.source} onChange={e => setForm({ ...form, source: e.target.value })} />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose} disabled={busy}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || !form.valuation || !form.valuationDate}>{busy ? 'Saving…' : 'Add'}</Button>
      </DialogActions>
      </Box>
    </Dialog>
  );
}
