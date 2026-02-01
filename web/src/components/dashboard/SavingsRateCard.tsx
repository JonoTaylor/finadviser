'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import SavingsRoundedIcon from '@mui/icons-material/SavingsRounded';
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

export default function SavingsRateCard({
  spending,
  balances,
}: {
  spending: SpendingRow[];
  balances: Balance[];
}) {
  const incomeTotal = balances
    .filter(b => b.account_type === 'INCOME')
    .reduce((sum, b) => sum.plus(new Decimal(b.balance).abs()), new Decimal(0));

  const expenseTotal = spending
    .reduce((sum, s) => sum.plus(new Decimal(s.total).abs()), new Decimal(0));

  const savingsRate = incomeTotal.gt(0)
    ? incomeTotal.minus(expenseTotal).div(incomeTotal).mul(100).toNumber()
    : 0;

  const clampedRate = Math.max(0, Math.min(100, savingsRate));
  const target = 20;

  const color =
    savingsRate < 10 ? '#FB7185' : savingsRate < 20 ? '#FBBF24' : '#4ADE80';

  // Ring SVG params — larger ring
  const size = 88;
  const stroke = 7;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (clampedRate / 100) * circumference;

  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: `linear-gradient(90deg, ${color}, ${alpha(color, 0.4)})`,
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha(color, 0.12),
            }}
          >
            <SavingsRoundedIcon sx={{ fontSize: 20, color }} />
          </Box>
          <Typography variant="subtitle2" color="text.secondary">Savings Rate</Typography>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2.5 }}>
          {/* Ring gauge with glow */}
          <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
            {/* Radial glow behind ring */}
            <Box
              sx={{
                position: 'absolute',
                inset: -8,
                borderRadius: '50%',
                background: `radial-gradient(circle, ${alpha(color, 0.12)} 0%, transparent 70%)`,
              }}
            />
            <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', position: 'relative' }}>
              <defs>
                <filter id="ring-glow">
                  <feGaussianBlur stdDeviation="3" result="blur" />
                  <feMerge>
                    <feMergeNode in="blur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={alpha(color, 0.1)} strokeWidth={stroke}
              />
              <circle
                cx={size / 2} cy={size / 2} r={radius}
                fill="none" stroke={color} strokeWidth={stroke}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                filter="url(#ring-glow)"
                style={{ transition: 'stroke-dashoffset 0.6s ease' }}
              />
            </svg>
            <Box
              sx={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}
            >
              <Typography variant="h6" sx={{ fontWeight: 800, fontSize: '1.1rem', color }}>
                {savingsRate.toFixed(0)}%
              </Typography>
            </Box>
          </Box>

          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
              Target: {target}%
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {savingsRate >= target
                ? 'You\'re on track!'
                : `${(target - savingsRate).toFixed(0)}% to go`}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
