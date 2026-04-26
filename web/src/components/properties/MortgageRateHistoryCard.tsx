'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Snackbar,
  Alert,
  Box,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';

interface RateRow {
  id: number;
  mortgageId: number;
  rate: string;
  effectiveDate: string;
  createdAt: string;
}

const fetcher = async (url: string): Promise<RateRow[]> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load rates (HTTP ${res.status})`);
  return res.json();
};

interface FormState {
  rate: string;
  effectiveDate: string;
}

const EMPTY_FORM: FormState = { rate: '', effectiveDate: '' };

/**
 * Manages a mortgage's rate history. Each row pins a rate to an
 * effective date — the calculator uses this to split any tax-year span
 * into rate-correct sub-periods. Sorted by effective date descending in
 * the UI; the calculator re-sorts internally so order here is purely
 * presentational.
 */
export default function MortgageRateHistoryCard({
  mortgageId,
  lender,
}: {
  mortgageId: number;
  lender: string;
}) {
  const url = `/api/mortgages/${mortgageId}/rates`;
  const { data: rates, error, isLoading, mutate } = useSWR<RateRow[]>(url, fetcher);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<RateRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openAdd = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };
  const openEdit = (r: RateRow) => {
    setEditing(r);
    setForm({ rate: r.rate, effectiveDate: r.effectiveDate });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.rate || !form.effectiveDate) {
      setErrorMsg('Rate and effective date are required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = { rate: form.rate, effectiveDate: form.effectiveDate };
      const res = await fetch(
        editing ? `/api/mortgages/${mortgageId}/rates/${editing.id}` : url,
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setDialogOpen(false);
      mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to save rate');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (rate: RateRow) => {
    if (!confirm(`Delete the ${rate.rate}% rate effective ${rate.effectiveDate}?`)) return;
    try {
      const res = await fetch(`/api/mortgages/${mortgageId}/rates/${rate.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      mutate();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : 'Failed to delete rate');
    }
  };

  const list = rates ?? [];

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h6">Rate history</Typography>
            <Typography variant="caption" color="text.secondary">
              {lender} — used to compute mortgage interest by sub-period
            </Typography>
          </Box>
          <Button startIcon={<AddIcon />} size="small" variant="outlined" onClick={openAdd}>
            Add rate
          </Button>
        </Stack>

        {isLoading && <Typography variant="body2" color="text.secondary">Loading…</Typography>}
        {error && <Alert severity="error">{error.message}</Alert>}

        {!isLoading && !error && list.length === 0 && (
          <Typography variant="body2" color="text.secondary">
            No rates entered yet. Add the rate that applied at mortgage start, then each subsequent
            change. The S.24 card will compute interest from this history once you have at least one
            entry covering the relevant tax year.
          </Typography>
        )}

        {list.length > 0 && (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Effective from</TableCell>
                <TableCell align="right">Rate</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {list.map(r => (
                <TableRow key={r.id}>
                  <TableCell>{r.effectiveDate}</TableCell>
                  <TableCell align="right">{Number(r.rate).toFixed(4)}%</TableCell>
                  <TableCell align="right">
                    <IconButton size="small" onClick={() => openEdit(r)} aria-label={`Edit rate ${r.effectiveDate}`}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" onClick={() => handleDelete(r)} aria-label={`Delete rate ${r.effectiveDate}`}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{editing ? 'Edit rate' : 'Add rate'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="Effective from"
              type="date"
              required
              slotProps={{ inputLabel: { shrink: true } }}
              value={form.effectiveDate}
              onChange={e => setForm({ ...form, effectiveDate: e.target.value })}
              helperText="The date the rate started to apply"
            />
            <TextField
              label="Rate (%)"
              type="number"
              required
              value={form.rate}
              onChange={e => setForm({ ...form, rate: e.target.value })}
              helperText="e.g. 5.25 for 5.25%"
              inputProps={{ step: '0.01', min: '0' }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)} disabled={submitting}>Cancel</Button>
          <Button variant="contained" onClick={handleSave} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(errorMsg)}
        autoHideDuration={5000}
        onClose={() => setErrorMsg(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity="error" onClose={() => setErrorMsg(null)}>{errorMsg}</Alert>
      </Snackbar>
    </Card>
  );
}
