'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';
import Decimal from 'decimal.js';

interface Balance {
  account_id: number;
  account_name: string;
  account_type: string;
  balance: string;
}

export default function NetWorthCard({ balances }: { balances: Balance[] }) {
  const assets = balances
    .filter(b => b.account_type === 'ASSET')
    .reduce((sum, b) => sum.plus(b.balance), new Decimal(0));

  const liabilities = balances
    .filter(b => b.account_type === 'LIABILITY')
    .reduce((sum, b) => sum.plus(new Decimal(b.balance).abs()), new Decimal(0));

  const netWorth = assets.minus(liabilities);
  const isPositive = netWorth.gte(0);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Net Worth
        </Typography>
        <Typography
          variant="h5"
          sx={{ color: isPositive ? 'success.main' : 'error.main', fontWeight: 700 }}
        >
          {formatCurrency(netWorth.toString())}
        </Typography>
        <Box sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Assets: {formatCurrency(assets.toString())}
          </Typography>
          <br />
          <Typography variant="caption" color="text.secondary">
            Liabilities: {formatCurrency(liabilities.toString())}
          </Typography>
        </Box>
      </CardContent>
    </Card>
  );
}
