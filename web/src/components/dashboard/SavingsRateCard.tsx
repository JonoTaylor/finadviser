'use client';

import { Card, CardContent, Typography, LinearProgress, Box } from '@mui/material';
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

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Savings Rate
        </Typography>
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          {savingsRate.toFixed(1)}%
        </Typography>
        <Box sx={{ mt: 1 }}>
          <LinearProgress
            variant="determinate"
            value={clampedRate}
            sx={{
              height: 8,
              borderRadius: 4,
              bgcolor: 'rgba(255,255,255,0.08)',
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
                bgcolor: savingsRate >= 20 ? 'success.main' : 'warning.main',
              },
            }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
