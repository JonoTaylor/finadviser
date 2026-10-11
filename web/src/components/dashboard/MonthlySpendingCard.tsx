'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Box, Button, Card, CardContent, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { format } from 'date-fns';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCashFlow, previousMonth, type MonthlySpendingRow } from '@/lib/dashboard/monthly-cash-flow';
import DashboardCardHeader, { metricValueSx } from './DashboardCardHeader';

export default function MonthlySpendingCard({ spending }: { spending: MonthlySpendingRow[] }) {
  const [month] = useState(() => londonTodayIso().slice(0, 7));
  const prior = previousMonth(month);
  const { expenses } = monthlyCashFlow(spending, month);
  const { expenses: previousExpenses } = monthlyCashFlow(spending, prior);
  const previousLabel = format(new Date(`${prior}-15T12:00:00Z`), 'MMMM');

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Monthly spending" subtitle="Recorded expenses, including refunds" />
    <Typography sx={metricValueSx}>{formatCurrency(expenses.toString())}</Typography>
    <Typography variant="caption" sx={{ display: 'block', mt: 0.75, mb: 2.5 }}>Household · month to date</Typography>
    <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
      <Typography variant="body2" color="text.secondary">{previousLabel}: <Box component="span" sx={{ fontWeight: 600, color: 'text.primary', fontVariantNumeric: 'tabular-nums' }}>{formatCurrency(previousExpenses.toString())}</Box></Typography>
      <Typography variant="caption" sx={{ display: 'block', mt: 0.5 }}>Previous calendar month, as recorded</Typography>
      <Button component={Link} href="/spending" size="small" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />} sx={{ mt: 1.25, px: 0 }}>Review spending</Button>
    </Box>
  </CardContent></Card>;
}
