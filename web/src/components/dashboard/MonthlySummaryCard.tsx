'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';
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
  // Get current month spending
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const monthExpenses = spending
    .filter(s => s.month === currentMonth)
    .reduce((sum, s) => sum.plus(new Decimal(s.total).abs()), new Decimal(0));

  // Estimate income from INCOME account balances (simplified)
  const incomeTotal = balances
    .filter(b => b.account_type === 'INCOME')
    .reduce((sum, b) => sum.plus(new Decimal(b.balance).abs()), new Decimal(0));

  const net = incomeTotal.minus(monthExpenses);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          This Month
        </Typography>
        <Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2">Expenses</Typography>
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
