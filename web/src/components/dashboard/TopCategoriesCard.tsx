'use client';

import { useMemo } from 'react';
import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded';
import ArrowDropUpRoundedIcon from '@mui/icons-material/ArrowDropUpRounded';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import { londonTodayIso } from '@/lib/dates/today';
import { format } from 'date-fns';
import Decimal from 'decimal.js';
import { softTokens } from '@/theme/theme';

interface SpendingRow {
  month: string;          // YYYY-MM
  category_name: string | null;
  account_type: string;   // e.g. 'INCOME' | 'EXPENSE'
  total: string;
}

function previousMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyyMm;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

function monthLabel(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  return format(new Date(y, m - 1, 1), 'MMM yyyy');
}

/**
 * Top spending + income categories THIS MONTH, with a small delta
 * showing the change vs LAST MONTH for each.
 *
 * Delta colours respect account_type: for EXPENSE categories, an
 * increase is a warning; for INCOME, an increase is a success.
 * The arrow direction (▲/▼) always reflects raw direction; only
 * the colour swaps based on whether more-of-this-thing is good or
 * bad. account_type per category is captured during aggregation
 * (one category → one type in this dataset).
 */
export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  const today = londonTodayIso();
  const currentMonth = today.slice(0, 7);
  const prevMonth = previousMonth(currentMonth);

  const { thisByCategory, prevByCategory, typeByCategory } = useMemo(() => {
    const thisMap = new Map<string, Decimal>();
    const prevMap = new Map<string, Decimal>();
    const typeMap = new Map<string, string>();
    for (const row of spending) {
      const cat = row.category_name || 'Uncategorized';
      if (!typeMap.has(cat)) typeMap.set(cat, row.account_type);
      const val = new Decimal(row.total).abs();
      if (row.month === currentMonth) {
        thisMap.set(cat, (thisMap.get(cat) ?? new Decimal(0)).plus(val));
      } else if (row.month === prevMonth) {
        prevMap.set(cat, (prevMap.get(cat) ?? new Decimal(0)).plus(val));
      }
    }
    return { thisByCategory: thisMap, prevByCategory: prevMap, typeByCategory: typeMap };
  }, [spending, currentMonth, prevMonth]);

  const sorted = useMemo(
    () =>
      Array.from(thisByCategory.entries())
        .sort(([, a], [, b]) => b.minus(a).toNumber())
        .slice(0, 5),
    [thisByCategory],
  );

  const topAmount = sorted.length > 0 && !sorted[0][1].isZero()
    ? sorted[0][1]
    : new Decimal(1);

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: softTokens.fog, color: softTokens.lavender.ink,
            }}
          >
            <DonutSmallRoundedIcon sx={{ fontSize: 20 }} />
          </Box>
          <Box>
            <Typography variant="subtitle2">Top Categories</Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1.2 }}>
              {monthLabel(currentMonth)} · vs {monthLabel(prevMonth)}
            </Typography>
          </Box>
        </Box>

        {sorted.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            No spending data yet for {monthLabel(currentMonth)}.
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1.25 }}>
            {sorted.map(([cat, amount]) => {
              const previous = prevByCategory.get(cat) ?? new Decimal(0);
              const delta = amount.minus(previous);
              const pct = topAmount.lte(0) ? 0 : amount.div(topAmount).mul(100).toNumber();
              const { fill } = getCategoryColor(cat);
              const deltaIsZero = delta.abs().lt('0.01');
              const deltaUp = delta.gt(0);
              const isIncome = typeByCategory.get(cat) === 'INCOME';
              const goodDirection = isIncome ? deltaUp : !deltaUp;
              const deltaColor = goodDirection ? softTokens.mint.ink : softTokens.peach.ink;
              return (
                <Box key={cat}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Box
                        sx={{
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          bgcolor: fill,
                          flexShrink: 0,
                        }}
                      />
                      <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>{cat}</Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {formatCurrency(amount.toString())}
                      </Typography>
                      {!deltaIsZero && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                          {deltaUp
                            ? <ArrowDropUpRoundedIcon sx={{ fontSize: 16, color: deltaColor, m: -0.5 }} />
                            : <ArrowDropDownRoundedIcon sx={{ fontSize: 16, color: deltaColor, m: -0.5 }} />}
                          <Typography
                            variant="caption"
                            sx={{ color: deltaColor, fontWeight: 500 }}
                          >
                            {formatCurrency(delta.abs().toString())}
                          </Typography>
                        </Box>
                      )}
                      {deltaIsZero && (
                        <Typography variant="caption" color="text.disabled">·</Typography>
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ ml: 2.5, height: 6, borderRadius: 3, bgcolor: alpha(fill, 0.14) }}>
                    <Box
                      sx={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 3,
                        bgcolor: fill,
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
