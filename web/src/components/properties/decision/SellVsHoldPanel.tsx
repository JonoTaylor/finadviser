'use client';

import { useMemo, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Grid,
  Slider,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import Decimal from 'decimal.js';
import { projectOpportunityCost, type PropertyContext } from '@/lib/properties/btl-decision';
import { estimateNetSaleProceeds } from '@/lib/properties/btl-decision';
import { formatCurrency } from '@/lib/utils/formatting';

export interface SellVsHoldPanelProps {
  context: PropertyContext;
  annualMortgageInterest: Decimal;
  defaultSalePrice: Decimal;
  sellingCosts: Decimal;
}

export default function SellVsHoldPanel({
  context,
  annualMortgageInterest,
  defaultSalePrice,
  sellingCosts,
}: SellVsHoldPanelProps) {
  const [equityReturnPct, setEquityReturnPct] = useState(6);
  const [propertyGrowthPct, setPropertyGrowthPct] = useState(2);
  const [horizon, setHorizon] = useState<5 | 10>(10);

  const result = useMemo(() => {
    const proceeds = estimateNetSaleProceeds({
      salePrice: defaultSalePrice,
      mortgageBalanceAtSale: context.mortgageBalance,
      sellingCosts,
      acquisitionCost: context.acquisitionCost,
      ownerCount: context.ownerCount,
      marginalRatePct: context.marginalRatePct,
    });
    return projectOpportunityCost({
      propertyValue: context.latestValuation,
      mortgageBalance: context.mortgageBalance,
      initialProceedsIfSold: proceeds.netProceeds,
      annualRent: context.annualRent,
      annualRunningCosts: context.annualRunningCosts,
      annualMortgageInterest,
      marginalRatePct: context.marginalRatePct,
      ownerCount: context.ownerCount,
      equityReturnPct: new Decimal(equityReturnPct),
      propertyGrowthPct: new Decimal(propertyGrowthPct),
      yearsToProject: horizon,
    });
  }, [context, defaultSalePrice, sellingCosts, annualMortgageInterest, equityReturnPct, propertyGrowthPct, horizon]);

  const xValues = result.years.map(y => y.yearIndex);
  const holdSeries = result.years.map(y => Math.round(y.hold.netWealth.toNumber()));
  const sellSeries = result.years.map(y => Math.round(y.sellAndGlide.netWealth.toNumber()));
  const finalYear = result.years[result.years.length - 1];
  if (!finalYear) return null;

  return (
    <Box>
      <Card sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Sell vs hold
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Hold path: property grows, after-tax rental cash flow accumulates
            and compounds at the equity return. Sell path: net proceeds flow
            into an ISA (up to £20k per owner per year), the rest into a GIA
            and bed-and-ISA into the shelter over subsequent years.
          </Typography>

          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <SliderRow
                label="Equity return"
                value={equityReturnPct}
                min={3}
                max={10}
                step={0.5}
                valueLabel={`${equityReturnPct}%`}
                onChange={setEquityReturnPct}
              />
              <SliderRow
                label="Property growth"
                value={propertyGrowthPct}
                min={0}
                max={5}
                step={0.5}
                valueLabel={`${propertyGrowthPct}%`}
                onChange={setPropertyGrowthPct}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                Horizon
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={horizon}
                onChange={(_, v) => v && setHorizon(v)}
              >
                <ToggleButton value={5}>5 years</ToggleButton>
                <ToggleButton value={10}>10 years</ToggleButton>
              </ToggleButtonGroup>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      <Card variant="outlined" sx={{ mb: 2 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Net wealth projection
          </Typography>
          <Box sx={{ width: '100%', height: 320 }}>
            <LineChart
              xAxis={[{ data: xValues, label: 'Years', scaleType: 'linear' }]}
              series={[
                {
                  data: holdSeries,
                  label: 'Hold property',
                  color: '#1f3a68',
                  showMark: true,
                  valueFormatter: (v: number | null) =>
                    v == null ? '' : `£${Math.round(v).toLocaleString()}`,
                },
                {
                  data: sellSeries,
                  label: 'Sell and glide',
                  color: '#1e8449',
                  showMark: true,
                  valueFormatter: (v: number | null) =>
                    v == null ? '' : `£${Math.round(v).toLocaleString()}`,
                },
              ]}
              height={320}
              margin={{ top: 10, right: 10, bottom: 40, left: 80 }}
            />
          </Box>
          <Stack direction="row" spacing={3} sx={{ mt: 1 }}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Hold at year {horizon}
              </Typography>
              <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(finalYear.hold.netWealth.toFixed(2))}
              </Typography>
            </Box>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Sell and glide at year {horizon}
              </Typography>
              <Typography variant="h6" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                {formatCurrency(finalYear.sellAndGlide.netWealth.toFixed(2))}
              </Typography>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Glide path detail
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Year</TableCell>
                <TableCell align="right">ISA in</TableCell>
                <TableCell align="right">ISA balance</TableCell>
                <TableCell align="right">GIA in</TableCell>
                <TableCell align="right">GIA balance</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.glideDetail.map(year => (
                <TableRow key={year.yearIndex}>
                  <TableCell>Y{year.yearIndex}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(year.isaContribution.toFixed(2))}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(year.isaBalance.toFixed(2))}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(year.giaContribution.toFixed(2))}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatCurrency(year.giaBalance.toFixed(2))}
                  </TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {formatCurrency(year.totalBalance.toFixed(2))}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </Box>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  valueLabel,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  valueLabel: string;
  onChange: (next: number) => void;
}) {
  return (
    <Box sx={{ mb: 2 }}>
      <Stack direction="row" justifyContent="space-between">
        <Typography variant="body2">{label}</Typography>
        <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          {valueLabel}
        </Typography>
      </Stack>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(_, v) => onChange(typeof v === 'number' ? v : v[0])}
        sx={{ mt: 0.5 }}
      />
    </Box>
  );
}
