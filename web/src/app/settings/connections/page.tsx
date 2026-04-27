'use client';

import { useState, Suspense } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Stack, Chip, Alert, IconButton, Snackbar,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
} from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import SyncRoundedIcon from '@mui/icons-material/SyncRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import { format, formatDistanceToNow } from 'date-fns';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { softTokens } from '@/theme/theme';

type ProviderSlug = 'monzo' | 'barclays' | 'amex_uk' | 'yonder';
type ConnectionStatus = 'pending' | 'active' | 'expiring' | 'expired' | 'revoked' | 'error';

interface ConnectionRow {
  id: number;
  providerSlug: ProviderSlug;
  providerDisplayName: string;
  status: ConnectionStatus;
  consentExpiresAt: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  institutionName: string;
  createdAt: string;
}

const PROVIDER_LABEL: Record<ProviderSlug, string> = {
  monzo: 'Monzo',
  barclays: 'Barclays',
  amex_uk: 'American Express UK',
  yonder: 'Yonder',
};

const STATUS_CHIP: Record<ConnectionStatus, { label: string; tile: string; ink: string }> = {
  pending:  { label: 'Pending',     tile: softTokens.lemon.main,    ink: softTokens.lemon.ink },
  active:   { label: 'Active',      tile: softTokens.mint.main,     ink: softTokens.mint.ink },
  expiring: { label: 'Expiring',    tile: softTokens.lemon.main,    ink: softTokens.lemon.ink },
  expired:  { label: 'Expired',     tile: softTokens.peach.main,    ink: softTokens.peach.ink },
  revoked:  { label: 'Revoked',     tile: softTokens.stone,         ink: softTokens.ink2 },
  error:    { label: 'Error',       tile: softTokens.peach.main,    ink: softTokens.peach.ink },
};

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body;
};

export default function ConnectionsPage() {
  return (
    <Suspense fallback={null}>
      <ConnectionsPageInner />
    </Suspense>
  );
}

function ConnectionsPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const errorFromCallback = searchParams.get('error');

  const { data, error, isLoading, mutate } = useSWR<{ connections: ConnectionRow[] }>(
    '/api/banking/connections',
    fetcher,
    { revalidateOnFocus: false },
  );

  const [snack, setSnack] = useState<{ open: boolean; severity: 'success' | 'error' | 'info'; message: string }>({
    open: !!errorFromCallback,
    severity: 'error',
    message: errorFromCallback ?? '',
  });
  const [pendingProvider, setPendingProvider] = useState<ProviderSlug | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ConnectionRow | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);

  const connectedSlugs = new Set((data?.connections ?? []).map(c => c.providerSlug));
  const allSlugs: ProviderSlug[] = ['monzo', 'barclays', 'amex_uk', 'yonder'];

  async function startConnect(slug: ProviderSlug) {
    setPendingProvider(slug);
    try {
      const res = await fetch('/api/banking/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: slug }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      window.location.href = body.consentUrl;
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Failed to start connect flow' });
      setPendingProvider(null);
    }
  }

  async function handleDelete(conn: ConnectionRow) {
    setConfirmDelete(null);
    try {
      const res = await fetch(`/api/banking/connections/${conn.id}`, { method: 'DELETE' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      setSnack({ open: true, severity: 'success', message: `Disconnected ${conn.providerDisplayName}` });
      mutate();
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Failed to disconnect' });
    }
  }

  async function handleSync(conn: ConnectionRow) {
    setSyncingId(conn.id);
    try {
      const res = await fetch(`/api/banking/connections/${conn.id}/sync`, { method: 'POST' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      setSnack({
        open: true,
        severity: 'success',
        message: `Synced ${conn.providerDisplayName}: ${body.txnsAdded} new transaction${body.txnsAdded === 1 ? '' : 's'}`,
      });
      mutate();
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Sync failed' });
    } finally {
      setSyncingId(null);
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton size="small" component={Link} href="/settings">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box>
          <Typography variant="h4">Bank connections</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Linked bank accounts via GoCardless Bank Account Data. Reconsent every 90 days (PSD2).
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}

      <Stack spacing={2.5}>
        {/* ── Existing connections ─────────────────────────── */}
        {(data?.connections ?? []).map(conn => {
          const chip = STATUS_CHIP[conn.status];
          const expiresAt = conn.consentExpiresAt ? new Date(conn.consentExpiresAt) : null;
          const lastSync = conn.lastSyncedAt ? new Date(conn.lastSyncedAt) : null;
          return (
            <Card key={conn.id}>
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
                    <Typography variant="h6">{conn.providerDisplayName}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {conn.institutionName}
                    </Typography>
                  </Box>
                  <Chip
                    label={chip.label}
                    size="small"
                    sx={{ bgcolor: chip.tile, color: chip.ink, fontWeight: 600 }}
                  />
                </Box>

                <Stack direction="row" spacing={3} sx={{ mb: 2, flexWrap: 'wrap' }} useFlexGap>
                  {expiresAt && (
                    <DataPair
                      label="Consent expires"
                      value={`${format(expiresAt, 'd MMM yyyy')} (${formatDistanceToNow(expiresAt, { addSuffix: true })})`}
                    />
                  )}
                  <DataPair
                    label="Last synced"
                    value={lastSync ? `${formatDistanceToNow(lastSync, { addSuffix: true })}` : 'Never'}
                  />
                </Stack>

                {conn.lastError && (
                  <Alert severity="warning" sx={{ mb: 2 }}>{conn.lastError}</Alert>
                )}

                <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
                  {conn.status === 'pending' && (
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<LinkRoundedIcon />}
                      onClick={() => startConnect(conn.providerSlug)}
                    >
                      Resume connect
                    </Button>
                  )}
                  {(conn.status === 'active' || conn.status === 'expiring') && (
                    <>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<SyncRoundedIcon />}
                        onClick={() => handleSync(conn)}
                        disabled={syncingId === conn.id}
                      >
                        {syncingId === conn.id ? 'Syncing...' : 'Sync now'}
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        component={Link}
                        href={`/settings/connections/${conn.id}/map`}
                      >
                        Map accounts
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<HistoryRoundedIcon />}
                        component={Link}
                        href={`/settings/connections/${conn.id}/sync-runs`}
                      >
                        Sync history
                      </Button>
                    </>
                  )}
                  {(conn.status === 'expired' || conn.status === 'error' || conn.status === 'revoked') && (
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<RefreshRoundedIcon />}
                      onClick={() => startConnect(conn.providerSlug)}
                    >
                      Reconnect
                    </Button>
                  )}
                  <Button
                    variant="outlined"
                    size="small"
                    color="error"
                    startIcon={<LinkOffRoundedIcon />}
                    onClick={() => setConfirmDelete(conn)}
                  >
                    Disconnect
                  </Button>
                </Stack>
              </CardContent>
            </Card>
          );
        })}

        {/* ── Available providers (not yet connected) ─────── */}
        <Card>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1.5 }}>Add a connection</Typography>
            {!isLoading && allSlugs.every(s => connectedSlugs.has(s)) && (
              <Typography variant="body2" color="text.secondary">
                All four supported banks are connected.
              </Typography>
            )}
            <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
              {allSlugs.filter(s => !connectedSlugs.has(s)).map(slug => (
                <Button
                  key={slug}
                  variant="outlined"
                  size="small"
                  startIcon={<LinkRoundedIcon />}
                  onClick={() => startConnect(slug)}
                  disabled={pendingProvider === slug}
                >
                  {pendingProvider === slug ? 'Redirecting...' : `Connect ${PROVIDER_LABEL[slug]}`}
                </Button>
              ))}
            </Stack>
          </CardContent>
        </Card>

        <MonzoManualTokenCard onSaved={(message) => {
          setSnack({ open: true, severity: 'success', message });
          mutate();
        }} />
      </Stack>

      <Dialog open={confirmDelete !== null} onClose={() => setConfirmDelete(null)}>
        <DialogTitle>Disconnect {confirmDelete?.providerDisplayName}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The aggregator-side requisition is removed and no further syncs will run.
            Already-imported transactions stay where they are; reconnecting later creates a
            fresh consent and a new account-mapping wizard.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDelete(null)}>Cancel</Button>
          <Button color="error" onClick={() => confirmDelete && handleDelete(confirmDelete)}>
            Disconnect
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => {
          setSnack(s => ({ ...s, open: false }));
          if (errorFromCallback) router.replace('/settings/connections');
        }}
      >
        <Alert
          severity={snack.severity}
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}

function DataPair({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textTransform: 'uppercase', fontSize: '0.7rem', letterSpacing: '0.05em' }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontWeight: 500 }}>{value}</Typography>
    </Box>
  );
}

function MonzoManualTokenCard({ onSaved }: { onSaved: (message: string) => void }) {
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const router = useRouter();

  async function handleSubmit() {
    if (!token.trim()) return;
    setSubmitting(true);
    setLocalError(null);
    try {
      const res = await fetch('/api/banking/connections/monzo/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessToken: token.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      onSaved(`Monzo connected via manual token. ${body.accountsAvailable} account${body.accountsAvailable === 1 ? '' : 's'} ready to map.`);
      setToken('');
      router.push(`/settings/connections/${body.connectionId}/map`);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : 'Failed to validate token');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card sx={{ borderLeft: `3px solid ${softTokens.lemon.deep}` }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 1.5 }}>
          <Box sx={{
            width: 36, height: 36, borderRadius: 2.5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            bgcolor: softTokens.lemon.main, color: softTokens.lemon.ink,
          }}>
            <KeyRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h6">Monzo: manual token (playground)</Typography>
            <Typography variant="caption" color="text.secondary">
              Workaround when your Monzo OAuth client is not Confidential.
            </Typography>
          </Box>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Open <a href="https://developers.monzo.com/api/playground" target="_blank" rel="noreferrer">developers.monzo.com/api/playground</a>,
          tap <strong>Authorise</strong> on the access token row, copy the token, and paste it here.
          The token is good for 6 hours; you&apos;ll need to repeat this when it expires (or get a Confidential client from
          {' '}<a href="mailto:developer-support@monzo.com">developer-support@monzo.com</a> for refresh-token support).
        </Typography>

        <TextField
          label="Monzo access token"
          fullWidth
          size="small"
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="eyJhbGciOi..."
          sx={{ mb: 1.5 }}
        />

        {localError && (
          <Alert severity="error" sx={{ mb: 1.5 }}>{localError}</Alert>
        )}

        <Stack direction="row" spacing={1.5}>
          <Button
            variant="contained"
            size="small"
            onClick={handleSubmit}
            disabled={submitting || !token.trim()}
          >
            {submitting ? 'Validating...' : 'Save token + connect'}
          </Button>
        </Stack>
      </CardContent>
    </Card>
  );
}
