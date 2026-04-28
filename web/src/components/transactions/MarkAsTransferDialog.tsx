'use client';

import { useEffect, useState } from 'react';
import {
  Dialog, DialogTitle, DialogContent, DialogActions, Button,
  Box, Typography, Chip, MenuItem, Select, FormControl, InputLabel,
  CircularProgress, Alert, Stack,
} from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

const TRANSFER_KINDS: Array<{ value: string; label: string }> = [
  { value: 'statement_payment', label: 'Statement Payment (CC payoff)' },
  { value: 'pot_transfer', label: 'Pot Transfer' },
  { value: 'self_transfer', label: 'Self Transfer' },
  { value: 'cross_bank', label: 'Cross-Bank Transfer' },
  { value: 'refund', label: 'Refund' },
  { value: 'manual', label: 'Other / Manual' },
];

interface Candidate {
  id: number;
  date: string;
  description: string;
  accountName: string;
  amount: string;
  dateDriftDays: number;
}

export default function MarkAsTransferDialog({
  open,
  journalId,
  description,
  onClose,
  onMarked,
}: {
  open: boolean;
  journalId: number | null;
  description: string;
  onClose: () => void;
  onMarked: () => void;
}) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedPartner, setSelectedPartner] = useState<number | null>(null);
  const [kind, setKind] = useState<string>('manual');

  useEffect(() => {
    if (!open || journalId == null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelectedPartner(null);
    setKind('manual');
    fetch(`/api/journal/transfers?journalId=${journalId}&windowDays=7`)
      .then(r => r.json())
      .then(data => {
        if (cancelled) return;
        if (data?.error) {
          setError(data.error);
          setCandidates([]);
        } else {
          setCandidates(data.candidates ?? []);
        }
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load candidates');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, journalId]);

  async function handleSubmit() {
    if (journalId == null) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch('/api/journal/transfers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          journalId,
          pairedJournalId: selectedPartner ?? undefined,
          kind,
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        setError(data?.error ?? 'Failed to mark as transfer');
        return;
      }
      onMarked();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to mark as transfer');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Mark as transfer</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Box>
            <Typography variant="caption" color="text.secondary">
              Source transaction
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 500 }}>
              {description}
            </Typography>
          </Box>

          <FormControl fullWidth size="small">
            <InputLabel id="transfer-kind-label">Transfer kind</InputLabel>
            <Select
              labelId="transfer-kind-label"
              label="Transfer kind"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {TRANSFER_KINDS.map(k => (
                <MenuItem key={k.value} value={k.value}>{k.label}</MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="caption" color="text.secondary">
              Partner transaction (optional - merges both into one journal)
            </Typography>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
                <CircularProgress size={20} />
              </Box>
            ) : candidates.length === 0 ? (
              <Typography variant="body2" sx={{ mt: 1, color: 'text.secondary' }}>
                No opposite-sign matches found within +/- 7 days. The single
                journal will be flagged as a transfer.
              </Typography>
            ) : (
              <Stack spacing={1} sx={{ mt: 1 }}>
                {candidates.map(c => {
                  const selected = selectedPartner === c.id;
                  return (
                    <Box
                      key={c.id}
                      onClick={() => setSelectedPartner(selected ? null : c.id)}
                      sx={{
                        p: 1.5,
                        border: '1px solid',
                        borderColor: selected ? 'primary.main' : 'divider',
                        bgcolor: selected ? 'action.selected' : 'transparent',
                        borderRadius: 1,
                        cursor: 'pointer',
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Box>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {c.description}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {c.date} - {c.accountName}
                            {c.dateDriftDays > 0 ? ` (+/-${c.dateDriftDays}d drift)` : ''}
                          </Typography>
                        </Box>
                        <Chip
                          label={formatCurrency(c.amount)}
                          size="small"
                          color={parseFloat(c.amount) >= 0 ? 'success' : 'error'}
                          variant="outlined"
                        />
                      </Box>
                    </Box>
                  );
                })}
              </Stack>
            )}
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button
          onClick={handleSubmit}
          variant="contained"
          disabled={submitting}
        >
          {submitting ? 'Saving...' : selectedPartner ? 'Merge as transfer' : 'Flag as transfer'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
