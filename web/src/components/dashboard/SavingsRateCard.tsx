'use client';

import { useState } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCashFlow } from '@/lib/dashboard/monthly-cash-flow';
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

export default function SavingsRateCard({
  spending,
  balances: _balances,
}: {
  spending: SpendingRow[];
  balances: Balance[];
}) {
  // Lifetime account balances cannot be compared with monthly spending.
  void _balances;
  const [month] = useState(() => londonTodayIso().slice(0, 7));
  const { savingsRate } = monthlyCashFlow(spending, month);
  const clampedRate = Math.max(0, Math.min(100, savingsRate ?? 0));

  // Map rate -> mint (good) / lemon (getting there) / peach (off track)
  const palette = savingsRate === null
    ? softTokens.lavender
    : savingsRate < 10
    ? softTokens.peach
    : savingsRate < 20 ? softTokens.lemon : softTokens.mint;

  const size = 88;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedRate / 100) * circumference;

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: palette.main, color: palette.ink,
            }}
          >
            <SavingsRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="subtitle2">Savings Rate</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={alpha(palette.deep, 0.18)} strokeWidth={stroke}
              />
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={palette.deep} strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <Box
              sx={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Typography
                sx={{
                  fontFamily: serifFamily,
                  fontStyle: 'italic',
                  fontWeight: 400,
                  fontSize: '1.5rem',
                  lineHeight: 1,
                  color: palette.ink,
                }}
              >
                {savingsRate === null ? '—' : `${savingsRate.toFixed(0)}%`}
              </Typography>
            </Box>
          </Box>

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              This month
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {savingsRate === null
                ? 'Record positive income to calculate your rate'
                : savingsRate < 0
                  ? 'Recorded expenses exceed income'
                  : 'Income left after recorded expenses'}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
