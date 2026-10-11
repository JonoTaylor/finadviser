'use client';

import { useState } from 'react';
import { Card, CardContent, Typography, Box, LinearProgress } from '@mui/material';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCashFlow } from '@/lib/dashboard/monthly-cash-flow';
import DashboardCardHeader, { metricValueSx } from './DashboardCardHeader';

interface SpendingRow { month: string; category_name: string | null; account_type: string; total: string }
interface Balance { account_id: number; account_name: string; account_type: string; balance: string }

export default function SavingsRateCard({ spending, balances: _balances }: { spending: SpendingRow[]; balances: Balance[] }) {
  void _balances;
  const [month] = useState(() => londonTodayIso().slice(0, 7));
  const { savingsRate } = monthlyCashFlow(spending, month);
  const clampedRate = Math.max(0, Math.min(100, savingsRate ?? 0));

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Savings rate" subtitle="This month" />
    <Typography sx={{ ...metricValueSx, color: savingsRate !== null && savingsRate < 0 ? 'error.main' : 'text.primary' }}>
      {savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
    </Typography>
    <Typography variant="caption" sx={{ display: 'block', mt: 0.75, mb: 2.5 }}>Income left after recorded expenses</Typography>
    <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
      {savingsRate !== null && <LinearProgress variant="determinate" value={clampedRate} color={savingsRate < 0 ? 'error' : 'success'} aria-label="Percentage of income remaining" sx={{ height: 5, borderRadius: '2px', mb: 1.5 }} />}
      <Typography variant="body2" color="text.secondary">
        {savingsRate === null ? 'Record positive income to calculate your rate.' : savingsRate < 0 ? 'Recorded expenses exceed income.' : 'Based on your recorded household income and spending.'}
      </Typography>
    </Box>
    <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Household · month to date</Typography>
  </CardContent></Card>;
}
