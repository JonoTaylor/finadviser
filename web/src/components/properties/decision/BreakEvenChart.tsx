'use client';

import { Box, Card, CardContent, Typography } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import type { BreakEvenSeries } from '@/lib/properties/btl-decision';

export interface BreakEvenChartProps {
  series: BreakEvenSeries[];
  /** Optional vertical marker for the user's chosen sale completion month. */
  saleCompletionMonth?: number;
}

const SERIES_COLORS = ['#1f3a68', '#c0392b', '#1e8449', '#d68910', '#7d3c98', '#16a085'];

export default function BreakEvenChart({ series, saleCompletionMonth }: BreakEvenChartProps) {
  if (series.length === 0 || series[0].points.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Add at least one product to see break-even curves.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const xValues = series[0].points.map(p => p.monthsHeld);
  const datasets = series.map((s, i) => ({
    data: s.points.map(p => p.cumulativeCost),
    label: s.productName,
    color: SERIES_COLORS[i % SERIES_COLORS.length],
    showMark: false,
  }));

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Cumulative cost by holding period
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Step-downs in each curve mark ERC tier expiry. The lowest curve at
          your target sale month wins.
        </Typography>
        <Box sx={{ width: '100%', height: 320 }}>
          <LineChart
            xAxis={[{
              data: xValues,
              label: 'Months held',
              scaleType: 'linear',
            }]}
            series={datasets.map(d => ({
              ...d,
              valueFormatter: (v: number | null) =>
                v == null ? '' : `£${Math.round(v).toLocaleString()}`,
            }))}
            height={320}
            margin={{ top: 10, right: 10, bottom: 40, left: 70 }}
          />
        </Box>
        {saleCompletionMonth != null && (
          <Typography variant="caption" color="text.secondary">
            Target sale month: month {saleCompletionMonth}.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
