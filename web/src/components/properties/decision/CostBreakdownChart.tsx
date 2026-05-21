'use client';

import { Box, Card, CardContent, Typography } from '@mui/material';
import { BarChart } from '@mui/x-charts/BarChart';
import type { StackedCostSeries } from '@/lib/properties/btl-decision';

export interface CostBreakdownChartProps {
  series: StackedCostSeries[];
}

export default function CostBreakdownChart({ series }: CostBreakdownChartProps) {
  if (series.length === 0) {
    return (
      <Card variant="outlined">
        <CardContent>
          <Typography variant="body2" color="text.secondary">
            Add at least one product to see a cost breakdown.
          </Typography>
        </CardContent>
      </Card>
    );
  }

  const labels = series.map(s => s.scenarioLabel);
  const datasets = [
    { label: 'Mortgage cost', data: series.map(s => s.mortgageInterestEx), color: '#1f3a68' },
    { label: 'ERC', data: series.map(s => s.erc), color: '#c0392b' },
    { label: 'Void cost', data: series.map(s => s.voidCost), color: '#d68910' },
    { label: 'EPC', data: series.map(s => s.epc), color: '#7d3c98' },
    { label: 'Net rental (credit)', data: series.map(s => s.netRentalCredit), color: '#1e8449' },
  ];

  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="h6" gutterBottom>
          Cost breakdown
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Leading product per scenario. Green is the rental credit against carry cost.
        </Typography>
        <Box sx={{ width: '100%', height: 320 }}>
          <BarChart
            xAxis={[{ scaleType: 'band', data: labels }]}
            series={datasets.map(d => ({
              data: d.data,
              label: d.label,
              stack: 'cost',
              color: d.color,
              valueFormatter: (v: number | null) =>
                v == null ? '' : `£${Math.round(v).toLocaleString()}`,
            }))}
            height={320}
            margin={{ top: 10, right: 10, bottom: 30, left: 70 }}
          />
        </Box>
      </CardContent>
    </Card>
  );
}
