'use client';

import { Card, CardContent, Typography, Box, Button, Stack } from '@mui/material';
import { alpha } from '@mui/material/styles';
import AccountBalanceWalletRoundedIcon from '@mui/icons-material/AccountBalanceWalletRounded';
import ChatRoundedIcon from '@mui/icons-material/ChatRounded';
import useSWR from 'swr';
import { format } from 'date-fns';
import Link from 'next/link';
import { softTokens } from '@/theme/theme';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface BudgetStatus {
  budget_id: number;
  category_id: number;
  category_name: string;
  monthly_limit: string;
  spent: string;
}

function paletteForUtilisation(pct: number) {
  if (pct > 90) return softTokens.peach;
  if (pct > 70) return softTokens.lemon;
  return softTokens.mint;
}

export default function BudgetOverviewCard() {
  const month = format(new Date(), 'yyyy-MM');
  const { data: budgets } = useSWR<BudgetStatus[]>(`/api/budgets/status?month=${month}`, fetcher);

  if (!budgets || budgets.length === 0) {
    return (
      <Card sx={{ height: '100%' }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Box
              sx={{
                width: 36, height: 36, borderRadius: 2.5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
              }}
            >
              <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20 }} />
            </Box>
            <Typography variant="subtitle2">Budget Overview</Typography>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            No budgets set up yet. Use the AI chat to create budgets for your spending categories.
          </Typography>
          <Button
            component={Link}
            href="/chat"
            size="small"
            variant="outlined"
            startIcon={<ChatRoundedIcon />}
          >
            Set up budgets
          </Button>
        </CardContent>
      </Card>
    );
  }

  const top = budgets.slice(0, 5);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
            }}
          >
            <AccountBalanceWalletRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Typography variant="subtitle2">Budget Overview</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
            {format(new Date(), 'MMM yyyy')}
          </Typography>
        </Box>

        <Stack spacing={1.5}>
          {top.map((b) => {
            const limit = parseFloat(b.monthly_limit);
            const spent = parseFloat(b.spent);
            const pct = limit > 0 ? Math.min(100, Math.round((spent / limit) * 100)) : 0;
            const palette = paletteForUtilisation(pct);

            return (
              <Box key={b.budget_id}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                  <Typography variant="caption" sx={{ fontWeight: 500 }}>
                    {b.category_name}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    £{spent.toFixed(0)} / £{limit.toFixed(0)}
                  </Typography>
                </Box>
                <Box
                  sx={{
                    height: 8, borderRadius: 4, bgcolor: alpha(palette.deep, 0.18),
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      height: '100%',
                      width: `${pct}%`,
                      borderRadius: 4,
                      bgcolor: palette.deep,
                      transition: 'width 0.4s ease',
                    }}
                  />
                </Box>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
