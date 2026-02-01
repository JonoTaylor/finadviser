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

export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  // Aggregate by category across all months
  const byCategory: Record<string, Decimal> = {};
  for (const row of spending) {
    const cat = row.category_name || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = new Decimal(0);
    byCategory[cat] = byCategory[cat].plus(new Decimal(row.total).abs());
  }

  const sorted = Object.entries(byCategory)
    .sort(([, a], [, b]) => b.minus(a).toNumber())
    .slice(0, 5);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          Top Categories
        </Typography>
        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No data</Typography>
        ) : (
          sorted.map(([cat, amount]) => (
            <Box key={cat} sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>{cat}</Typography>
              <Typography variant="body2" fontWeight={600}>
                {formatCurrency(amount.toString())}
              </Typography>
            </Box>
          ))
        )}
      </CardContent>
    </Card>
  );
}
