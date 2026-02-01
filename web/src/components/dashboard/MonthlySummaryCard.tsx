'use client';

import { Card, CardContent, Typography, Box, Chip } from '@mui/material';
import { alpha } from '@mui/material/styles';
import CalendarMonthRoundedIcon from '@mui/icons-material/CalendarMonthRounded';
import TrendingUpRoundedIcon from '@mui/icons-material/TrendingUpRounded';
import TrendingDownRoundedIcon from '@mui/icons-material/TrendingDownRounded';
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

  const trendPct = prevMonthExpenses.gt(0)
    ? monthExpenses.minus(prevMonthExpenses).div(prevMonthExpenses).mul(100).toNumber()
    : 0;
  const trendUp = trendPct > 0;

  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #818CF8, #F472B6)',
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box
              sx={{
                width: 36, height: 36, borderRadius: 2.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: alpha('#818CF8', 0.12),
              }}
            >
              <CalendarMonthRoundedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
            </Box>
            <Typography variant="subtitle2" color="text.secondary">This Month</Typography>
          </Box>
          {prevMonthExpenses.gt(0) && (
            <Chip
              icon={trendUp
                ? <TrendingUpRoundedIcon sx={{ fontSize: '14px !important' }} />
                : <TrendingDownRoundedIcon sx={{ fontSize: '14px !important' }} />
              }
              label={`${Math.abs(trendPct).toFixed(0)}%`}
              size="small"
              sx={{
                height: 24,
                bgcolor: alpha(trendUp ? '#FB7185' : '#4ADE80', 0.12),
                color: trendUp ? 'error.main' : 'success.main',
                fontWeight: 600,
                fontSize: '0.75rem',
                boxShadow: `0 0 8px ${alpha(trendUp ? '#FB7185' : '#4ADE80', 0.15)}`,
                '& .MuiChip-icon': { color: 'inherit' },
              }}
            />
          )}
        </Box>

        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          <Row label="Income" value={formatCurrency(incomeTotal.toString())} color="success.main" />
          <Row label="Expenses" value={formatCurrency(monthExpenses.toString())} color="error.main" />
          <Box
            sx={{
              height: '1px',
              background: `linear-gradient(90deg, transparent, ${alpha('#818CF8', 0.3)}, transparent)`,
            }}
          />
          <Row
            label="Net"
            value={formatCurrency(net.toString())}
            color={net.gte(0) ? 'success.main' : 'error.main'}
            bold
          />
        </Box>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, color, bold }: { label: string; value: string; color: string; bold?: boolean }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" sx={{ color, fontWeight: bold ? 700 : 600 }}>{value}</Typography>
    </Box>
  );
}
