'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { glowShadow, gradientText } from '@/theme/theme';
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
    <Card
      sx={{
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        boxShadow: isPositive ? glowShadow.success : glowShadow.error,
      }}
    >
      {/* Ambient glow at top */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: 80,
          background: `radial-gradient(ellipse 80% 100% at 50% 0%, ${alpha(isPositive ? '#4ADE80' : '#FB7185', 0.1)} 0%, transparent 70%)`,
          pointerEvents: 'none',
        }}
      />
      <CardContent sx={{ position: 'relative' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: alpha('#E8C547', 0.12),
            }}
          >
            <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20, color: 'primary.main' }} />
          </Box>
          <Typography variant="subtitle2" color="text.secondary">
            Net Worth
          </Typography>
        </Box>

        <Typography
          variant="h4"
          sx={{
            fontWeight: 800,
            fontSize: '1.75rem',
            letterSpacing: '-0.03em',
            mb: 2,
            ...gradientText(
              isPositive ? '#4ADE80' : '#FB7185',
              isPositive ? '#16A34A' : '#E11D48',
            ),
          }}
        >
          {formatCurrency(netWorth.toString())}
        </Typography>

        <Box sx={{ display: 'flex', gap: 2 }}>
          <Box sx={{ flex: 1, p: 1.25, borderRadius: 2, bgcolor: alpha('#4ADE80', 0.08) }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <ArrowUpwardRoundedIcon sx={{ fontSize: 14, color: 'success.main' }} />
              <Typography variant="caption" color="success.main" fontWeight={600}>Assets</Typography>
            </Box>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {formatCurrency(assets.toString())}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, p: 1.25, borderRadius: 2, bgcolor: alpha('#FB7185', 0.08) }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
              <ArrowDownwardRoundedIcon sx={{ fontSize: 14, color: 'error.main' }} />
              <Typography variant="caption" color="error.main" fontWeight={600}>Liabilities</Typography>
            </Box>
            <Typography variant="body2" fontWeight={600} color="text.primary">
              {formatCurrency(liabilities.toString())}
            </Typography>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
}
