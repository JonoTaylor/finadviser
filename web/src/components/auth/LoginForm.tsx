'use client';

import { useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  Box,
  Typography,
  TextField,
  Button,
  Alert,
  Stack,
  IconButton,
  InputAdornment,
} from '@mui/material';
import ShowChartRoundedIcon from '@mui/icons-material/ShowChartRounded';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import VisibilityOffOutlinedIcon from '@mui/icons-material/VisibilityOffOutlined';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';

/**
 * Only accept same-origin relative paths in ?next. Reject:
 *   - protocol/host URLs (https://attacker.tld) — open redirect
 *   - protocol-relative (//attacker.tld) — open redirect via host coercion
 *   - paths starting with '\' which some browsers normalise to '/'
 *   - anything not starting with a single '/'
 * Fall back to '/' for anything dodgy.
 */
function sanitiseNext(value: string | null): string {
  if (!value) return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.includes('\\')) return '/';
  return value;
}

export default function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = sanitiseNext(searchParams.get('next'));

  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const submittingRef = useRef(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as { error?: string }));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      // Use replace so /login isn't kept in the history.
      router.replace(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Login failed');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'minmax(360px, 0.85fr) 1fr' } }}>
      <Box sx={{ bgcolor: '#0F172A', color: '#F8FAFC', p: { xs: 3, md: 6 }, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
        <Stack direction="row" alignItems="center" gap={1.5}>
          <Box sx={{ display: 'flex', p: 1, bgcolor: '#115E59', borderRadius: '8px' }}><ShowChartRoundedIcon sx={{ color: '#5EEAD4' }} /></Box>
          <Typography sx={{ fontWeight: 650, fontSize: '1.125rem', letterSpacing: '-0.025em' }}>FinAdviser</Typography>
        </Stack>
        <Box sx={{ display: { xs: 'none', md: 'block' }, maxWidth: 380, py: 8 }}>
          <Typography component="h2" sx={{ fontSize: '2.5rem', fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1.2, mb: 2 }}>Your financial workspace.</Typography>
          <Typography sx={{ color: '#CBD5E1', fontSize: '0.9375rem', mb: 5 }}>Bring your day-to-day finances and long-term plans into one clear view.</Typography>
          <Stack gap={3}>{[
            ['Daily finances', 'Accounts, spending and saving'],
            ['Long-term planning', 'Investments and pensions'],
            ['Property management', 'Rent, mortgages and obligations'],
          ].map(([title, detail]) => <Box key={title} sx={{ borderLeft: '2px solid #115E59', pl: 2 }}><Typography sx={{ fontWeight: 550, fontSize: '0.875rem' }}>{title}</Typography><Typography sx={{ color: '#94A3B8', fontSize: '0.8125rem', mt: 0.5 }}>{detail}</Typography></Box>)}</Stack>
        </Box>
        <Typography sx={{ display: { xs: 'none', md: 'block' }, color: '#94A3B8', fontSize: '0.75rem' }}>Personal finance · GBP</Typography>
      </Box>
      <Box component="main" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', bgcolor: 'background.paper', p: { xs: 3, sm: 5 }, minHeight: { xs: 'calc(100dvh - 88px)', md: '100dvh' } }}>
        <Box sx={{ width: '100%', maxWidth: 380 }}>
          <Typography variant="h4" component="h1" sx={{ mb: 1 }}>Welcome back</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>Sign in to access your finances and saved plans.</Typography>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              {error && <Alert severity="error" role="alert">{error}</Alert>}
              <TextField
                label="Password"
                type={showPassword ? 'text' : 'password'}
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                fullWidth
                required
                disabled={submitting}
                slotProps={{ input: { endAdornment: <InputAdornment position="end"><IconButton aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)} disabled={submitting} edge="end" size="small">{showPassword ? <VisibilityOffOutlinedIcon fontSize="small" /> : <VisibilityOutlinedIcon fontSize="small" />}</IconButton></InputAdornment> } }}
              />
              <Button
                type="submit"
                variant="contained"
                disabled={!password || submitting}
                fullWidth
                size="large"
                endIcon={<ArrowForwardRoundedIcon />}
              >
                {submitting ? 'Signing in…' : 'Sign in'}
              </Button>
            </Stack>
          </Box>
          <Typography variant="caption" sx={{ display: 'block', mt: 3 }}>Use your FinAdviser app password.</Typography>
        </Box>
      </Box>
    </Box>
  );
}
