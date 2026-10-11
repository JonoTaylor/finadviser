'use client';

import Link from 'next/link';
import { Card, CardContent, Typography, Box, Button, Stack } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCategories, previousMonth } from '@/lib/dashboard/monthly-cash-flow';
import { format } from 'date-fns';
import Decimal from 'decimal.js';
import DashboardCardHeader from './DashboardCardHeader';

interface SpendingRow { month: string; category_name: string | null; account_type: string; total: string }

function monthLabel(month: string): string {
  return format(new Date(`${month}-15T12:00:00Z`), 'MMM yyyy');
}

export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  const currentMonth = londonTodayIso().slice(0, 7);
  const prevMonth = previousMonth(currentMonth);
  const sorted = monthlyCategories(spending, currentMonth).slice(0, 5);
  const topAmount = sorted.length > 0 && sorted[0].amount.gt(0) ? sorted[0].amount : new Decimal(1);

  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title="Category activity" subtitle={`${monthLabel(currentMonth)} · compared with ${monthLabel(prevMonth)}`}
      action={<Button component={Link} href="/spending" size="small">View spending</Button>} />
    {sorted.length === 0 ? <Box sx={{ py: 4 }}>
      <Typography variant="body2" color="text.secondary">No spending data yet for {monthLabel(currentMonth)}.</Typography>
      <Button component={Link} href="/import" size="small" variant="outlined" sx={{ mt: 2 }}>Import transactions</Button>
    </Box> : <Stack spacing={2.1}>
      {sorted.map(({ key, category, amount, previous, accountType }) => {
        const delta = amount.minus(previous);
        const pct = Math.max(0, Math.min(100, amount.div(topAmount).mul(100).toNumber()));
        const isIncome = accountType === 'INCOME';
        const deltaIsZero = delta.abs().lt('0.01');
        const goodDirection = isIncome ? delta.gt(0) : delta.lt(0);
        return <Box key={key} sx={{ minWidth: 0 }}>
          <Stack direction="row" justifyContent="space-between" gap={1} alignItems="baseline" sx={{ mb: 0.75 }}>
            <Typography variant="body2" sx={{ fontWeight: 500, minWidth: 0, overflowWrap: 'anywhere' }}>{category}{isIncome ? ' · income' : ''}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatCurrency(amount.toString())}</Typography>
          </Stack>
          <Stack direction="row" alignItems="center" gap={2}>
            <Box sx={{ flex: 1, height: 6, borderRadius: '2px', bgcolor: 'action.hover', overflow: 'hidden', minWidth: 0 }}>
              <Box sx={{ width: `${pct}%`, height: '100%', borderRadius: '2px', bgcolor: isIncome ? 'text.secondary' : 'success.main' }} />
            </Box>
            <Typography variant="caption" sx={{ minWidth: 98, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: deltaIsZero ? 'text.secondary' : goodDirection ? 'success.dark' : 'error.dark' }}>
              {deltaIsZero ? 'No change' : `${delta.gt(0) ? '+' : '−'}${formatCurrency(delta.abs().toString())}`}
            </Typography>
          </Stack>
        </Box>;
      })}
    </Stack>}
    <Typography variant="caption" sx={{ display: 'block', mt: 2.5, borderTop: 1, borderColor: 'divider', pt: 1.5 }}>Five largest recorded categories. Changes compare the current month to date with the previous calendar month.</Typography>
  </CardContent></Card>;
}
