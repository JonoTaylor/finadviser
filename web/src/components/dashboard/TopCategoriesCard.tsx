'use client';

import { Card, CardContent, Typography, Box } from '@mui/material';
import { alpha } from '@mui/material/styles';
import DonutSmallRoundedIcon from '@mui/icons-material/DonutSmallRounded';
import ArrowDropUpRoundedIcon from '@mui/icons-material/ArrowDropUpRounded';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import { londonTodayIso } from '@/lib/dates/today';
import { monthlyCategories, previousMonth } from '@/lib/dashboard/monthly-cash-flow';
import { format } from 'date-fns';
import Decimal from 'decimal.js';
import { softTokens } from '@/theme/theme';

interface SpendingRow {
  month: string;          // YYYY-MM
  category_name: string | null;
  account_type: string;   // e.g. 'INCOME' | 'EXPENSE'
  total: string;
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
 * bad. Income and expense rows with the same category name remain
 * separate, and refunds reduce their expense bucket.
 */
export default function TopCategoriesCard({ spending }: { spending: SpendingRow[] }) {
  const today = londonTodayIso();
  const currentMonth = today.slice(0, 7);
  const prevMonth = previousMonth(currentMonth);

  const sorted = monthlyCategories(spending, currentMonth).slice(0, 5);

  const topAmount = sorted.length > 0 && sorted[0].amount.gt(0)
    ? sorted[0].amount
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
            {sorted.map(({ key, category: cat, amount, previous, accountType }) => {
              const delta = amount.minus(previous);
              const pct = Math.max(0, Math.min(100, amount.div(topAmount).mul(100).toNumber()));
              const { fill } = getCategoryColor(cat);
              const deltaIsZero = delta.abs().lt('0.01');
              const deltaUp = delta.gt(0);
              const isIncome = accountType === 'INCOME';
              const goodDirection = isIncome ? deltaUp : !deltaUp;
              const deltaColor = goodDirection ? softTokens.mint.ink : softTokens.peach.ink;
              return (
                <Box key={key}>
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
                      <Typography variant="body2" noWrap sx={{ maxWidth: 120 }}>
                        {cat}{isIncome ? ' · income' : ''}
                      </Typography>
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
