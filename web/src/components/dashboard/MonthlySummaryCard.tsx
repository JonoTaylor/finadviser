'use client';

import { useState } from 'react';
import { Card, CardContent, Typography, Box, Stack } from '@mui/material';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCashFlow } from '@/lib/dashboard/monthly-cash-flow';
import DashboardCardHeader, { metricValueSx } from './DashboardCardHeader';

interface SpendingRow { month: string; category_name: string | null; account_type: string; total: string }
interface Balance { account_id: number; account_name: string; account_type: string; balance: string }

export default function MonthlySummaryCard({ spending, balances: _balances }: { spending: SpendingRow[]; balances: Balance[] }) {
  // Monthly journal activity is the source; lifetime income balances are not cash flow.
  void _balances;
  const [currentMonth] = useState(() => londonTodayIso().slice(0, 7));
  const { expenses, income, surplus } = monthlyCashFlow(spending, currentMonth);

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Monthly cash flow" subtitle={format(new Date(`${currentMonth}-15T12:00:00Z`), 'MMMM yyyy')} />
    <Typography sx={{ ...metricValueSx, color: surplus.gte(0) ? 'text.primary' : 'error.main' }}>{formatCurrency(surplus.toString())}</Typography>
    <Typography variant="caption" sx={{ display: 'block', mt: 0.75, mb: 2.5 }}>Income less recorded expenses</Typography>
    <Stack spacing={1.1} sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
      <Row label="Income" value={formatCurrency(income.toString())} />
      <Row label="Expenses" value={formatCurrency(expenses.toString())} />
    </Stack>
    <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Household · month to date</Typography>
  </CardContent></Card>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
    <Typography variant="body2" color="text.secondary">{label}</Typography>
    <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{value}</Typography>
  </Box>;
}
