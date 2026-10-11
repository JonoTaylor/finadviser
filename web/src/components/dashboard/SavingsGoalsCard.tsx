'use client';

import { Alert, Card, CardContent, Typography, Box, Button, Stack, Skeleton, LinearProgress } from '@mui/material';
import useSWR from 'swr';
import Link from 'next/link';
import Decimal from 'decimal.js';
import { fetchJson } from '@/lib/http/client';
import { formatCurrency } from '@/lib/utils/formatting';
import DashboardCardHeader from './DashboardCardHeader';

interface SavingsGoal { id: number; name: string; targetAmount: string; currentAmount: string; targetDate: string | null; status: string }

export default function SavingsGoalsCard() {
  const { data: goals, error, isLoading } = useSWR<SavingsGoal[]>('/api/savings-goals', fetchJson, { shouldRetryOnError: false });
  const activeGoals = (goals ?? []).filter(goal => goal.status === 'active');

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Savings goals" subtitle="Make progress toward what matters"
      action={<Button component={Link} href="/goals" size="small">Manage</Button>} />
    {error ? <Alert severity="warning">Your savings goals could not be loaded. Please try again when your accounts are connected.</Alert> : isLoading ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: '6px' }} /> : activeGoals.length === 0 ? <Box sx={{ py: 3 }}>
      <Typography variant="body2" color="text.secondary">Give your savings a purpose. Set a target and date, then track your progress.</Typography>
      <Button component={Link} href="/goals" size="small" variant="outlined" sx={{ mt: 2 }}>Add a goal</Button>
    </Box> : <>
      <Stack spacing={2.5}>
        {activeGoals.slice(0, 4).map(goal => {
          const target = new Decimal(goal.targetAmount);
          const current = new Decimal(goal.currentAmount);
          const pct = target.gt(0) ? Math.max(0, Math.min(100, Math.round(current.div(target).mul(100).toNumber()))) : 0;
          const remaining = Decimal.max(0, target.minus(current));
          return <Box key={goal.id}>
            <Stack direction="row" justifyContent="space-between" gap={1} alignItems="baseline" sx={{ mb: 0.5 }}>
              <Typography variant="body2" sx={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{goal.name}</Typography>
              <Typography variant="caption" sx={{ fontWeight: 600, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{pct}%</Typography>
            </Stack>
            <Typography variant="caption" sx={{ display: 'block', mb: 1, fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(current.toString())} of {formatCurrency(target.toString())}</Typography>
            <LinearProgress variant="determinate" value={pct} color="success" aria-label={`${goal.name} progress`} sx={{ height: 5, borderRadius: '2px' }} />
            <Typography variant="caption" sx={{ display: 'block', mt: 0.75 }}>{formatCurrency(remaining.toString())} remaining{goal.targetDate ? ` · by ${goal.targetDate}` : ''}</Typography>
          </Box>;
        })}
      </Stack>
      <Typography variant="caption" sx={{ display: 'block', mt: 2.5, borderTop: 1, borderColor: 'divider', pt: 1.5 }}>Recorded goal allocations{activeGoals.length > 4 ? ` · showing four of ${activeGoals.length} active goals` : ''}</Typography>
    </>}
  </CardContent></Card>;
}
