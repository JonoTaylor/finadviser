'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import { formatCurrency } from '@/lib/utils/formatting';
import { format, subMonths } from 'date-fns';
import Decimal from 'decimal.js';

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

export default function MonthlySummaryCard({
  spending,
  balances,
}: {
  spending: SpendingRow[];
  balances: Balance[];
}) {
  const now = new Date();
  const currentMonth = format(now, 'yyyy-MM');
  const prevMonth = format(subMonths(now, 1), 'yyyy-MM');

  const monthExpenses = spending
    .filter(s => s.month === currentMonth)
    .reduce((sum, s) => sum.plus(new Decimal(s.total).abs()), new Decimal(0));

  const prevMonthExpenses = spending
    .filter(s => s.month === prevMonth)
    .reduce((sum, s) => sum.plus(new Decimal(s.total).abs()), new Decimal(0));

  const incomeTotal = balances
    .filter(b => b.account_type === 'INCOME')
    .reduce((sum, b) => sum.plus(new Decimal(b.balance).abs()), new Decimal(0));

  const net = incomeTotal.minus(monthExpenses);

  // Month-over-month expense trend
  const trendPct = prevMonthExpenses.gt(0)
    ? monthExpenses.minus(prevMonthExpenses).div(prevMonthExpenses).mul(100).toNumber()
    : 0;
  const trendUp = trendPct > 0;

  return (
    <Card sx={{ height: '100%', borderLeft: '3px solid', borderColor: 'info.main' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'rgba(69, 183, 209, 0.12)',
            }}
          >
            <CalendarMonthIcon sx={{ fontSize: 18, color: 'info.main' }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            This Month
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Income</Typography>
            <Typography variant="body2" color="success.main" fontWeight={600}>
              {formatCurrency(incomeTotal.toString())}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2">Expenses</Typography>
              {prevMonthExpenses.gt(0) && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                  {trendUp ? (
                    <TrendingUpIcon sx={{ fontSize: 14, color: 'error.main' }} />
                  ) : (
                    <TrendingDownIcon sx={{ fontSize: 14, color: 'success.main' }} />
                  )}
                  <Typography
                    variant="caption"
                    sx={{ color: trendUp ? 'error.main' : 'success.main', fontSize: '0.65rem' }}
                  >
                    {Math.abs(trendPct).toFixed(0)}%
                  </Typography>
                </Box>
              )}
            </Box>
            <Typography variant="body2" color="error.main" fontWeight={600}>
              {formatCurrency(monthExpenses.toString())}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography variant="body2">Net</Typography>
            <Typography
              variant="body2"
              fontWeight={600}
              color={net.gte(0) ? 'success.main' : 'error.main'}
            >
              {formatCurrency(net.toString())}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
