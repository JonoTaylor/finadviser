'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded';
import ArrowDropUpRoundedIcon from '@mui/icons-material/ArrowDropUpRounded';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import { londonTodayIso } from '@/lib/dates/today';
import Decimal from 'decimal.js';

interface SpendingRow {
  month: string;          // YYYY-MM
  category_name: string | null;
  account_type: string;
  total: string;
}

/**
 * Convert a YYYY-MM string to the previous month's YYYY-MM. Pure
 * arithmetic — no DST edge cases since we're working on (year,
 * month) tuples, not Date objects.
 */
function previousMonth(yyyyMm: string): string {
  const [y, m] = yyyyMm.split('-').map(Number);
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yyyyMm;
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
}

/**
 * Top spending + income categories THIS MONTH, with a small delta
 * showing the change vs LAST MONTH for each. Earlier versions of
 * this card aggregated every row in `spending` regardless of
 * month, so it was effectively showing lifetime totals (matching
 * the £119k Income / £107k Uncategorized bug seen on the
 * dashboard). Filtering to a specific month was always the intent;
 * the comparison-vs-last-month is the new bit the user asked for.
 *
 * For each category in the top-5 by absolute this-month total:
 *   - amount = sum of rows where month = currentMonth
 *   - previous = sum of rows where month = previousMonth
 *   - delta = amount - previous
 *
 * For income categories the "up" direction is good (green); for
 * expenses, "up" is bad (warning colour). We don't currently
 * inspect account_type per category — the colour just signals
 * direction with a generic up/down arrow.
 */
export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  const today = londonTodayIso();              // YYYY-MM-DD
  const currentMonth = today.slice(0, 7);      // YYYY-MM
  const prevMonth = previousMonth(currentMonth);

  const accumulate = (month: string) => {
    const map = new Map<string, Decimal>();
    for (const row of spending) {
      if (row.month !== month) continue;
      const cat = row.category_name || 'Uncategorized';
      const cur = map.get(cat) ?? new Decimal(0);
      map.set(cat, cur.plus(new Decimal(row.total).abs()));
    }
    return map;
  };

  const thisByCategory = accumulate(currentMonth);
  const prevByCategory = accumulate(prevMonth);

  const sorted = Array.from(thisByCategory.entries())
    .sort(([, a], [, b]) => b.minus(a).toNumber())
    .slice(0, 5);

  const topAmount = sorted.length > 0 ? sorted[0][1] : new Decimal(1);

  const monthLabel = (yyyyMm: string) => {
    const [y, m] = yyyyMm.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' });
  };

  return (
    <Card sx={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
      <Box
        sx={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 3,
          background: 'linear-gradient(90deg, #E8C547, #C9A82E)',
        }}
      />
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <Box
            sx={{
              width: 36, height: 36, borderRadius: 2.5,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              bgcolor: alpha('#E8C547', 0.12),
            }}
          >
            <DonutSmallRoundedIcon sx={{ fontSize: 20, color: '#E8C547' }} />
          </Box>
          <Box>
            <Typography variant="subtitle2" color="text.secondary">Top Categories</Typography>
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
              const pct = amount.div(topAmount).mul(100).toNumber();
              const color = getCategoryColor(cat);
              const deltaIsZero = delta.abs().lt('0.01');
              const deltaUp = delta.gt(0);
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
                    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5 }}>
                      <Typography variant="body2" fontWeight={600}>
                        {formatCurrency(amount.toString())}
                      </Typography>
                      {!deltaIsZero && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0 }}>
                          {deltaUp
                            ? <ArrowDropUpRoundedIcon sx={{ fontSize: 16, color: 'warning.main', m: -0.5 }} />
                            : <ArrowDropDownRoundedIcon sx={{ fontSize: 16, color: 'success.main', m: -0.5 }} />}
                          <Typography
                            variant="caption"
                            color={deltaUp ? 'warning.main' : 'success.main'}
                            sx={{ fontWeight: 500 }}
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
