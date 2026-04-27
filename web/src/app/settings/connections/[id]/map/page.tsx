'use client';

import { useState, useEffect, use } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Stack, Chip, Alert, IconButton,
  TextField, MenuItem, Snackbar,
} from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { softTokens } from '@/theme/theme';

interface AggregatorAccount {
  aggregatorAccountRef: string;
  iban: string | null;
  currency: string;
  ownerName: string | null;
  product: string | null;
}

interface InternalAccount {
  id: number;
  name: string;
  account_type: string;
  balance: string;
}

interface LinkedAccount {
  id: number;
  accountId: number;
  accountName: string;
  aggregatorAccountRef: string;
  cutoverDate: string | null;
}

interface ConnectionDetail {
  connection: {
    id: number;
    providerDisplayName: string;
    institutionName: string;
    status: string;
  };
  linkedAccounts: LinkedAccount[];
  aggregatorAccounts: AggregatorAccount[];
  aggregatorError: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body;
};

interface MappingDraft {
  accountId: number | '';
  cutoverDate: string;
}

export default function MappingWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const connectionId = parseInt(id, 10);
  const router = useRouter();

  // SWR key conditional on a valid id so we don't fire a request to
  // /api/banking/connections/NaN when the route param is malformed.
  // (We can't conditionally call useSWR; we condition the key
  // instead.)
  const { data, error, isLoading, mutate } = useSWR<ConnectionDetail>(
    Number.isNaN(connectionId) ? null : `/api/banking/connections/${connectionId}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: accountsData } = useSWR<InternalAccount[]>('/api/accounts?balances=true', fetcher);

  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; severity: 'success' | 'error' | 'info'; message: string }>({
    open: false, severity: 'success', message: '',
  });

  // Pre-populate drafts from any already-linked rows + sane defaults
  // for unlinked aggregator accounts.
  useEffect(() => {
    if (!data) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const next: Record<string, MappingDraft> = {};
    for (const agg of data.aggregatorAccounts) {
      const linked = data.linkedAccounts.find(l => l.aggregatorAccountRef === agg.aggregatorAccountRef);
      next[agg.aggregatorAccountRef] = {
        accountId: linked?.accountId ?? '',
        cutoverDate: linked?.cutoverDate ?? today,
      };
    }
    setDrafts(next);
  }, [data]);

  if (Number.isNaN(connectionId)) {
    return (
      <Box>
        <Alert severity="error">Invalid connection id.</Alert>
      </Box>
    );
  }

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    try {
      const mappings = data.aggregatorAccounts
        .filter(agg => drafts[agg.aggregatorAccountRef]?.accountId !== '')
        .map(agg => {
          const d = drafts[agg.aggregatorAccountRef]!;
          return {
            aggregatorAccountRef: agg.aggregatorAccountRef,
            accountId: d.accountId,
            iban: agg.iban,
            currency: agg.currency,
            product: agg.product,
            cutoverDate: d.cutoverDate,
          };
        });
      if (mappings.length === 0) {
        setSnack({ open: true, severity: 'error', message: 'Pick at least one account to map.' });
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/banking/connections/${connectionId}/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      setSnack({ open: true, severity: 'success', message: `Mapped ${body.mappings.length} account${body.mappings.length === 1 ? '' : 's'}` });
      mutate();
      // Auto-jump back after a short delay so the user sees the toast.
      setTimeout(() => router.push('/settings/connections'), 1200);
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Failed to save mappings' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton size="small" component={Link} href="/settings/connections">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box>
          <Typography variant="h4">Map accounts</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {data ? `${data.connection.providerDisplayName} - ${data.connection.institutionName}` : 'Loading...'}
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}
      {data?.aggregatorError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not fetch accounts from the aggregator: {data.aggregatorError}
        </Alert>
      )}

      {isLoading && <Typography variant="body2" color="text.secondary">Loading aggregator accounts...</Typography>}

      {data && data.aggregatorAccounts.length === 0 && !data.aggregatorError && (
        <Alert severity="info">
          No accounts available from this connection yet. The consent may still be propagating;
          try again in a few seconds.
        </Alert>
      )}

      {data && (
        <Stack spacing={2}>
          {data.aggregatorAccounts.map(agg => {
            const linked = data.linkedAccounts.find(l => l.aggregatorAccountRef === agg.aggregatorAccountRef);
            const draft = drafts[agg.aggregatorAccountRef];
            return (
              <Card key={agg.aggregatorAccountRef}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
                    <Box sx={{
                      width: 36, height: 36, borderRadius: 2.5,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
                    }}>
                      <AccountBalanceRoundedIcon sx={{ fontSize: 20 }} />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {agg.product ?? 'Account'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {agg.iban ?? agg.aggregatorAccountRef}
                      </Typography>
                      {agg.ownerName && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Owner: {agg.ownerName}
                        </Typography>
                      )}
                    </Box>
                    <Chip label={agg.currency} size="small" />
                    {linked && (
                      <Chip
                        icon={<CheckCircleRoundedIcon sx={{ fontSize: '14px !important' }} />}
                        label="Mapped"
                        size="small"
                        sx={{ bgcolor: softTokens.mint.main, color: softTokens.mint.ink, '& .MuiChip-icon': { color: 'inherit' } }}
                      />
                    )}
                  </Box>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                      select
                      label="Bind to internal account"
                      size="small"
                      fullWidth
                      value={draft?.accountId ?? ''}
                      onChange={(e) => setDrafts(d => ({
                        ...d,
                        [agg.aggregatorAccountRef]: { ...d[agg.aggregatorAccountRef], accountId: e.target.value === '' ? '' : Number(e.target.value) },
                      }))}
                      helperText="Pick an existing ASSET account (Bank, savings, etc)"
                    >
                      <MenuItem value=""><em>Skip this account</em></MenuItem>
                      {(accountsData ?? [])
                        .filter(a => a.account_type === 'ASSET')
                        .map(a => (
                          <MenuItem key={a.id} value={a.id}>
                            {a.name} ({a.account_type})
                          </MenuItem>
                        ))}
                    </TextField>
                    <TextField
                      label="Cutover date"
                      type="date"
                      size="small"
                      sx={{ minWidth: 180 }}
                      value={draft?.cutoverDate ?? ''}
                      onChange={(e) => setDrafts(d => ({
                        ...d,
                        [agg.aggregatorAccountRef]: { ...d[agg.aggregatorAccountRef], cutoverDate: e.target.value },
                      }))}
                      slotProps={{ inputLabel: { shrink: true } }}
                      helperText="Sync starts from this date"
                    />
                  </Stack>
                </CardContent>
              </Card>
            );
          })}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button component={Link} href="/settings/connections">Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={submitting || data.aggregatorAccounts.length === 0}
            >
              {submitting ? 'Saving...' : 'Save mappings'}
            </Button>
          </Box>
        </Stack>
      )}

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
      >
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
