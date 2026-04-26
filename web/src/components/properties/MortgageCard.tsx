'use client';

import { useState } from 'react';
import { Card, CardContent, Typography, Box, Switch, Tooltip, Snackbar, Alert } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';

interface Mortgage {
  id: number;
  lender: string;
  originalAmount: string;
  startDate: string;
  termMonths: number;
  interestOnly?: boolean;
}

export default function MortgageCard({
  mortgage,
  onChange,
}: {
  mortgage: Mortgage;
  onChange?: () => void;
}) {
  const [interestOnly, setInterestOnly] = useState<boolean>(Boolean(mortgage.interestOnly));
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleToggle = async (next: boolean) => {
    setSubmitting(true);
    const prev = interestOnly;
    setInterestOnly(next); // optimistic
    try {
      const res = await fetch(`/api/mortgages/${mortgage.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interestOnly: next }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      onChange?.();
    } catch (e) {
      setInterestOnly(prev); // rollback
      setErrorMsg(e instanceof Error ? e.message : 'Failed to update');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Card sx={{ mb: 2 }}>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary">Mortgage</Typography>
        <Typography variant="h6" sx={{ fontSize: '1rem' }}>{mortgage.lender}</Typography>
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Original</Typography>
            <Typography variant="body2">{formatCurrency(mortgage.originalAmount)}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Start Date</Typography>
            <Typography variant="body2">{mortgage.startDate}</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">Term</Typography>
            <Typography variant="body2">{Math.round(mortgage.termMonths / 12)} years</Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
            <Tooltip
              arrow
              title="Interest-only: principal stays at the original amount until the loan is refinanced or repaid. Used by the S.24 calculator to compute interest from the rate history."
            >
              {/* tabIndex makes the tooltip's help text keyboard-reachable;
                  the underlying span is otherwise non-focusable. */}
              <Typography
                component="span"
                variant="body2"
                color="text.secondary"
                tabIndex={0}
                sx={{ cursor: 'help' }}
              >
                Interest-only
              </Typography>
            </Tooltip>
            <Switch
              size="small"
              checked={interestOnly}
              disabled={submitting}
              onChange={e => handleToggle(e.target.checked)}
              inputProps={{ 'aria-label': `Toggle interest-only for ${mortgage.lender}` }}
            />
          </Box>
        </Box>
      </CardContent>
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
