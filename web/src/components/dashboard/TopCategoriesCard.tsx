'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded';
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
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #FB923C, #F97316)',
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#FB923C', 0.12),
            }}
          >
            <DonutSmallRoundedIcon sx={{ fontSize: 20, color: '#FB923C' }} />
          </Box>
          <Typography variant="subtitle2" color="text.secondary">Top Categories</Typography>
        </Box>

        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No spending data yet</Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {sorted.map(([cat, amount]) => {
              const pct = amount.div(topAmount).mul(100).toNumber();
              const color = getCategoryColor(cat);
              return (
                <Box key={cat}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: color,
                          flexShrink: 0,
                          boxShadow: `0 0 6px ${alpha(color, 0.4)}`,
                        }}
                      />
                      <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>{cat}</Typography>
                    </Box>
                    <Typography variant="body2" fontWeight={600}>
                      {formatCurrency(amount.toString())}
                    </Typography>
                  </Box>
                  <Box sx={{ ml: 2.5, height: 6, borderRadius: 3, bgcolor: alpha(color, 0.12) }}>
                    <Box
                      sx={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 3,
                        background: `linear-gradient(90deg, ${color}, ${alpha(color, 0.7)})`,
                        transition: 'width 0.4s ease',
                      }}
                    />
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
