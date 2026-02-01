'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import AccountBalanceWalletIcon from '@mui/icons-material/AccountBalanceWallet';
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
    <Card sx={{ height: '100%', borderLeft: '3px solid', borderColor: 'primary.main' }}>
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
              bgcolor: 'rgba(78, 205, 196, 0.12)',
            }}
          >
            <AccountBalanceWalletIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Net Worth
          </Typography>
        </Box>
        <Typography
          variant="h5"
          sx={{ color: isPositive ? 'success.main' : 'error.main', fontWeight: 700 }}
        >
          {formatCurrency(netWorth.toString())}
        </Typography>
        <Box sx={{ mt: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'success.main' }} />
            <Typography variant="caption" color="text.secondary">
              Assets: {formatCurrency(assets.toString())}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: 'error.main' }} />
            <Typography variant="caption" color="text.secondary">
              Liabilities: {formatCurrency(liabilities.toString())}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
