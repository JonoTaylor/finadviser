'use client';

import { useState } from 'react';
import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCashFlow, previousMonth } from '@/lib/dashboard/monthly-cash-flow';
import { softTokens, serifFamily } from '@/theme/theme';

interface SpendingRow {
  month: string;
  category_name: string | null;
  account_type: string;
  total: string;
}

interface Balance {
  account_id: number;
  account_name: string;
  account_type: string;
  balance: string;
}

/**
 * "This Month" panel.
 *
 * Income figure must come from THIS-MONTH journal entries, not the
 * cumulative INCOME account balance — `balances` is the lifetime sum and
 * was producing a wildly inflated figure (e.g. £140k when the user's
 * actual monthly income is a fraction of that). The v_monthly_spending
 * view now includes INCOME rows alongside EXPENSE; we derive both
 * figures from it.
 *
 * Income credits change sign for display. Expense refunds and income
 * reversals retain their effect on the month's net totals.
 */
export default function MonthlySummaryCard({
  spending,
  balances: _balances,
}: {
  spending: SpendingRow[];
  // Kept for API parity with the dashboard page; no longer used here
  // because lifetime balances aren't a meaningful "this month" income
  // figure.
  balances: Balance[];
}) {
  void _balances;

  // Pin "now" at mount so the month boundary can't shift between SSR
  // and hydration.
  const [currentMonth] = useState(() => londonTodayIso().slice(0, 7));
  const { expenses: monthExpenses, income: monthIncome } = monthlyCashFlow(spending, currentMonth);
  const { expenses: prevMonthExpenses } = monthlyCashFlow(spending, previousMonth(currentMonth));

  const net = monthIncome.minus(monthExpenses);
  const netIsPositive = net.gte(0);

  const trendPct = prevMonthExpenses.gt(0)
    ? monthExpenses.minus(prevMonthExpenses).div(prevMonthExpenses).mul(100).toNumber()
    : 0;
  const trendUp = trendPct > 0;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 36, height: 36, borderRadius: 2.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: softTokens.mint.main, color: softTokens.mint.ink,
              }}
            >
              <CalendarMonthRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Typography variant="subtitle2">This Month</Typography>
          </Box>
          {prevMonthExpenses.gt(0) && (
            <Chip
              icon={trendUp
                ? <TrendingUpRoundedIcon sx={{ fontSize: '14px !important' }} />
                : <TrendingDownRoundedIcon sx={{ fontSize: '14px !important' }} />
              }
              label={`${Math.abs(trendPct).toFixed(0)}%`}
              size="small"
              color={trendUp ? 'error' : 'success'}
              sx={{ '& .MuiChip-icon': { color: 'inherit' } }}
            />
          )}
        </Box>

        <Typography
          sx={{
            fontFamily: serifFamily,
            fontStyle: 'italic',
            fontWeight: 400,
            fontSize: '2.25rem',
            lineHeight: 1,
            letterSpacing: '-0.02em',
            color: netIsPositive ? softTokens.mint.ink : softTokens.peach.ink,
            mb: 2,
          }}
        >
          {formatCurrency(net.toString())}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <Row label="Income" value={formatCurrency(monthIncome.toString())} color={softTokens.mint.ink} />
          <Row label="Expenses" value={formatCurrency(monthExpenses.toString())} color={softTokens.peach.ink} />
        </Box>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ color, fontWeight: 600 }}>{value}</Typography>
    </Box>
  );
}
