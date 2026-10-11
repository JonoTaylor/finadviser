'use client';

import { useState } from 'react';
import { Alert, Card, CardContent, Typography, Box, Button, Stack, Skeleton, LinearProgress } from '@mui/material';
import useSWR from 'swr';
import { format } from 'date-fns';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { fetchJson } from '@/lib/http/client';
import { londonTodayIso } from '@/lib/dates/today';
import { formatCurrency } from '@/lib/utils/formatting';
import DashboardCardHeader from './DashboardCardHeader';

interface BudgetStatus { budget_id: number; category_id: number; category_name: string; monthly_limit: string; spent: string }

export default function BudgetOverviewCard() {
  const [now] = useState(() => new Date());
  const month = londonTodayIso(now).slice(0, 7);
  const { data: budgets, error, isLoading } = useSWR<BudgetStatus[]>(`/api/budgets/status?month=${month}`, fetchJson, { shouldRetryOnError: false });

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Spending limits" subtitle={format(new Date(`${month}-15T12:00:00Z`), 'MMMM yyyy')}
      action={<Button component={Link} href="/spending" size="small">Manage</Button>} />
    {error ? <Alert severity="warning">Your budgets could not be loaded. Please try again when your accounts are connected.</Alert> : isLoading ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: '6px' }} /> : !budgets?.length ? <Box sx={{ py: 3 }}>
      <Typography variant="body2" color="text.secondary">Set monthly category limits to see where your spending needs attention.</Typography>
      <Button component={Link} href="/spending" size="small" variant="outlined" sx={{ mt: 2 }}>Set spending limits</Button>
    </Box> : <>
      <Stack spacing={2}>
        {budgets.slice(0, 5).map(budget => {
          const limit = new Decimal(budget.monthly_limit);
          const spent = new Decimal(budget.spent);
          const utilisation = limit.gt(0) ? spent.div(limit).mul(100).toNumber() : 0;
          const pct = Math.max(0, Math.min(100, utilisation));
          const over = spent.minus(limit);
          return <Box key={budget.budget_id}>
            <Stack direction="row" justifyContent="space-between" gap={1} sx={{ mb: 0.75 }}>
              <Typography variant="body2" sx={{ fontWeight: 500, overflowWrap: 'anywhere' }}>{budget.category_name}</Typography>
              <Typography variant="caption" sx={{ flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(spent.toString())} / {formatCurrency(limit.toString())}</Typography>
            </Stack>
            <LinearProgress variant="determinate" value={pct} color={over.gt(0) ? 'error' : utilisation >= 90 ? 'warning' : 'success'} aria-label={`${budget.category_name} budget used`} sx={{ height: 5, borderRadius: '2px' }} />
            {over.gt(0) && <Typography variant="caption" sx={{ display: 'block', color: 'error.dark', mt: 0.5 }}>{formatCurrency(over.toString())} over limit</Typography>}
          </Box>;
        })}
      </Stack>
      <Typography variant="caption" sx={{ display: 'block', mt: 2.5, borderTop: 1, borderColor: 'divider', pt: 1.5 }}>Household · {budgets.length} active spending limit{budgets.length === 1 ? '' : 's'}{budgets.length > 5 ? ' · showing first five' : ''}</Typography>
    </>}
  </CardContent></Card>;
}
