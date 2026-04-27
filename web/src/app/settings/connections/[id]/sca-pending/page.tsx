'use client';

import { use, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Box, Typography, Card, CardContent, Stack, CircularProgress, Alert, Button,
} from '@mui/material';
import LockOpenRoundedIcon from '@mui/icons-material/LockOpenRounded';
import Link from 'next/link';
import { softTokens } from '@/theme/theme';

const POLL_INTERVAL_MS = 3_000;
const TIMEOUT_AFTER_MS = 5 * 60 * 1000;

/**
 * Monzo SCA wait page. After the OAuth callback, the user has to
 * open the Monzo app and tap Allow on the push notification we just
 * triggered. Until they do, every Monzo API call returns 403.
 *
 * This page polls /api/banking/connections/[id]/sca-status every
 * 3 seconds and redirects to the mapping wizard once the access
 * token is fully alive. If the user takes longer than 5 minutes
 * we stop polling (the token will likely have expired anyway) and
 * surface a "still waiting" message with a Reconnect link.
 */
export default function MonzoScaPendingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [status, setStatus] = useState<'pending' | 'active' | 'error' | 'timeout'>('pending');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const startedAt = Date.now();

    async function tick() {
      if (cancelled) return;
      try {
        const res = await fetch(`/api/banking/connections/${id}/sca-status`);
        const body = await res.json();
        if (cancelled) return;
        if (body.status === 'active') {
          setStatus('active');
          // Brief pause so the user sees the success state before
          // redirect, then route to the mapping wizard.
          setTimeout(() => router.replace(`/settings/connections/${id}/map`), 600);
          return;
        }
        if (body.status === 'error') {
          setStatus('error');
          setErrorMessage(body.message ?? 'Unknown error');
          return;
        }
      } catch (e) {
        // Transient network blip; let the next tick retry.
        console.warn('SCA poll error', e);
      }
      if (Date.now() - startedAt > TIMEOUT_AFTER_MS) {
        setStatus('timeout');
        return;
      }
      setTimeout(tick, POLL_INTERVAL_MS);
    }

    tick();
    return () => { cancelled = true; };
  }, [id, router]);

  return (
    <Box sx={{ maxWidth: 560, mx: 'auto', mt: 6 }}>
      <Card>
        <CardContent>
          <Stack alignItems="center" spacing={2.5} sx={{ py: 2, textAlign: 'center' }}>
            <Box
              sx={{
                width: 64, height: 64, borderRadius: 4,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
              }}
            >
              <LockOpenRoundedIcon sx={{ fontSize: 32 }} />
            </Box>

            {status === 'pending' && (
              <>
                <Typography variant="h5">Approve in your Monzo app</Typography>
                <Typography variant="body2" color="text.secondary">
                  Open Monzo on your phone. You should see a push notification
                  asking you to grant FinAdviser access to your data. Tap Allow.
                </Typography>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <CircularProgress size={16} />
                  <Typography variant="caption" color="text.secondary">
                    Waiting for approval...
                  </Typography>
                </Stack>
              </>
            )}

            {status === 'active' && (
              <>
                <Typography variant="h5">Approved</Typography>
                <Typography variant="body2" color="text.secondary">
                  Taking you to the account-mapping step...
                </Typography>
              </>
            )}

            {status === 'error' && (
              <>
                <Typography variant="h5">Something went wrong</Typography>
                <Alert severity="error" sx={{ width: '100%' }}>{errorMessage ?? 'Unknown error'}</Alert>
                <Button component={Link} href="/settings/connections" variant="contained">
                  Back to connections
                </Button>
              </>
            )}

            {status === 'timeout' && (
              <>
                <Typography variant="h5">Still waiting</Typography>
                <Typography variant="body2" color="text.secondary">
                  We have not heard back from your Monzo app for 5 minutes. Either
                  the push notification was missed or the app declined the request.
                  Try reconnecting and approve as soon as the prompt appears.
                </Typography>
                <Button component={Link} href="/settings/connections" variant="contained">
                  Back to connections
                </Button>
              </>
            )}
          </Stack>
        </CardContent>
      </Card>
    </Box>
  );
}
