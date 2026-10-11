'use client';

import { useRef, useState } from 'react';
import {
  Box, Typography, Card, CardContent, Stack, Chip, Button,
  CircularProgress, Snackbar, Alert, Divider,
} from '@mui/material';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';
import { fetchJson } from '@/lib/http/client';
import PageHeader from '@/components/ui/PageHeader';

interface Candidate {
  groupId: string;
  kind: string | null;
  journalA: { id: number; date: string; description: string; account: string; amount: string };
  journalB: { id: number; date: string; description: string; account: string; amount: string };
}

async function fetchCandidates(url: string): Promise<{ candidates: Candidate[] }> {
  const data = await fetchJson<{ candidates: Candidate[] }>(url);
  if (!Array.isArray(data.candidates)) throw new Error('Transfer candidates could not be read. Please retry.');
  return data;
}

function kindLabel(kind: string | null): string {
  if (!kind) return 'Transfer';
  return kind.split('_').map(w => w[0]?.toUpperCase() + w.slice(1)).join(' ');
}

export default function TransferReviewPage() {
  const { data, error, isLoading, mutate } = useSWR<{ candidates: Candidate[] }>(
    '/api/journal/transfers/review',
    fetchCandidates,
    { shouldRetryOnError: false },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  async function act(groupId: string, action: 'confirm' | 'reject') {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setBusy(groupId);
    try {
      const res = await fetch('/api/journal/transfers/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId, action }),
      });
      const result = await res.json();
      if (!res.ok || result?.error) {
        setSnackbar({ open: true, message: result?.error ?? 'Failed', severity: 'error' });
      } else {
        setSnackbar({
          open: true,
          message: action === 'confirm' ? 'Merged as transfer' : 'Dismissed candidate',
          severity: 'success',
        });
        mutate();
      }
    } catch (e) {
      setSnackbar({
        open: true,
        message: e instanceof Error ? e.message : 'Failed',
        severity: 'error',
      });
    } finally {
      pendingRef.current = false;
      setBusy(null);
    }
  }

  const candidates = data?.candidates ?? [];

  return (
    <Box>
      <PageHeader title="Transfer review" description="Review possible transfers between accounts. Confirm a pair to merge it into one balanced journal, or dismiss it to keep both transactions." />

      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
          <CircularProgress size={32} />
        </Box>
      ) : error ? (
        <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>
          Transfer candidates could not be loaded. Please retry to see your review queue.
        </Alert>
      ) : candidates.length === 0 ? (
        <Card>
          <CardContent>
            <Typography color="text.secondary">
              No pending transfer candidates. New ones land here after each daily sync.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Stack spacing={2}>
          {candidates.map(c => (
            <Card key={c.groupId}>
              <CardContent>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                  <SwapHorizRoundedIcon color="action" />
                  <Chip label={kindLabel(c.kind)} size="small" variant="outlined" />
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto', overflowWrap: 'anywhere' }}>
                    {c.groupId.slice(0, 8)}
                  </Typography>
                </Box>

                <Stack spacing={1.5}>
                  <LegRow leg={c.journalA} />
                  <Divider />
                  <LegRow leg={c.journalB} />
                </Stack>

                <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'flex-end', mt: 2 }}>
                  <Button
                    size="small"
                    onClick={() => act(c.groupId, 'reject')}
                    disabled={busy !== null}
                    startIcon={<CloseRoundedIcon />}
                  >
                    Dismiss
                  </Button>
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => act(c.groupId, 'confirm')}
                    disabled={busy !== null}
                    startIcon={<CheckRoundedIcon />}
                  >
                    Confirm transfer
                  </Button>
                </Box>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function LegRow({ leg }: { leg: Candidate['journalA'] }) {
  const num = parseFloat(leg.amount);
  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr) auto', sm: '100px minmax(0, 1fr) auto' }, alignItems: 'center', gap: { xs: 1, sm: 2 } }}>
      <Box sx={{ gridColumn: { xs: '1 / -1', sm: 'auto' }, color: 'text.secondary', fontSize: '0.8125rem' }}>
        {leg.date}
      </Box>
      <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          {leg.description}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {leg.account}
        </Typography>
      </Box>
      <Box
        sx={{
          color: num >= 0 ? 'success.main' : 'error.main',
          fontWeight: 600,
          fontFeatureSettings: '"tnum"',
          fontSize: '0.875rem',
          textAlign: 'right',
        }}
      >
        {formatCurrency(leg.amount)}
      </Box>
    </Box>
  );
}
