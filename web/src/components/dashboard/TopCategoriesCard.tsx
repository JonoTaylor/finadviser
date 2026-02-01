'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import CategoryIcon from '@mui/icons-material/Category';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import Decimal from 'decimal.js';

interface SpendingRow {
  month: string;
  category_name: string | null;
  account_type: string;
  total: string;
}

export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  const byCategory: Record<string, Decimal> = {};
  for (const row of spending) {
    const cat = row.category_name || 'Uncategorized';
    if (!byCategory[cat]) byCategory[cat] = new Decimal(0);
    byCategory[cat] = byCategory[cat].plus(new Decimal(row.total).abs());
  }

  const sorted = Object.entries(byCategory)
    .sort(([, a], [, b]) => b.minus(a).toNumber())
    .slice(0, 5);

  const topAmount = sorted.length > 0 ? sorted[0][1] : new Decimal(1);

  return (
    <Card sx={{ height: '100%', borderLeft: '3px solid', borderColor: 'warning.main' }}>
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
              bgcolor: 'rgba(254, 202, 87, 0.12)',
            }}
          >
            <CategoryIcon sx={{ fontSize: 18, color: 'warning.main' }} />
          </Box>
          <Typography variant="body2" color="text.secondary">
            Top Categories
          </Typography>
        </Box>
        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No data</Typography>
        ) : (
          sorted.map(([cat, amount]) => {
            const pct = amount.div(topAmount).mul(100).toNumber();
            const color = getCategoryColor(cat);
            return (
              <Box key={cat} sx={{ mb: 0.75, position: 'relative' }}>
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    bottom: 0,
                    width: `${pct}%`,
                    bgcolor: color,
                    opacity: 0.1,
                    borderRadius: 1,
                  }}
                />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', position: 'relative', py: 0.25, px: 0.5 }}>
                  <Typography variant="body2" noWrap sx={{ maxWidth: '60%' }}>{cat}</Typography>
                  <Typography variant="body2" fontWeight={600}>
                    {formatCurrency(amount.toString())}
                  </Typography>
                </Box>
              </Box>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}
