'use client';

import { useMemo, useState, use, lazy, Suspense } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Grid,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import DecisionDisclaimer from '@/components/properties/decision/DecisionDisclaimer';
import MortgageProductForm from '@/components/properties/decision/MortgageProductForm';
import ScenarioCards from '@/components/properties/decision/ScenarioCards';
import SensitivityControls, {
  DEFAULT_SENSITIVITY,
  type SensitivityState,
} from '@/components/properties/decision/SensitivityControls';
import KeyInsights from '@/components/properties/decision/KeyInsights';
import {
  buildBreakEvenSeries,
  buildDecisionMatrix,
  buildKeyInsights,
  buildStackedCostSeries,
  runScenarioComparison,
  type MortgageProduct,
  type PropertyContext,
  type ScenarioInputs,
} from '@/lib/properties/btl-decision';

// Lazy-load chart components so the initial bundle for the page stays
// small. The Scenario Explorer tab works without these; they're only
// needed once the user lands on the Sensitivity tab.
const CostBreakdownChart = lazy(
  () => import('@/components/properties/decision/CostBreakdownChart'),
);
const BreakEvenChart = lazy(
  () => import('@/components/properties/decision/BreakEvenChart'),
);
const TimelineChart = lazy(
  () => import('@/components/properties/decision/TimelineChart'),
);
const DecisionMatrix = lazy(
  () => import('@/components/properties/decision/DecisionMatrix'),
);

const fetcher = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

interface DecisionContextResponse {
  property: { id: number; name: string; address: string | null; purchasePrice: string | null };
  latestValuation: { valuation: string; valuationDate: string } | null;
  ownerCount: number;
  totalOutstandingBalance: string;
  activeTenancy: {
    id: number;
    tenantName: string;
    startDate: string;
    endDate: string | null;
    rentAmount: string;
    rentFrequency: string;
  } | null;
  annualRent: string;
  annualRunningCosts: string;
}

function buildScenarios(
  sensitivity: SensitivityState,
  activeTenancyEnd: string | null,
): ScenarioInputs[] {
  let monthsToTenancyEnd = 12;
  if (activeTenancyEnd) {
    const today = new Date();
    const end = new Date(activeTenancyEnd);
    const diff = Math.max(
      1,
      Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30)),
    );
    monthsToTenancyEnd = diff;
  }

  const baseSellingCosts = new Decimal(8000);
  const salePrice = new Decimal(sensitivity.salePrice);
  const tenantedSalePrice = salePrice.mul(
    new Decimal(100 - sensitivity.tenantedSaleDiscountPct).div(100),
  );
  const epc = new Decimal(sensitivity.epcRemediation);
  const userVoidMonths = sensitivity.voidMonths;

  return [
    {
      key: 'ride_out',
      label: 'Ride out tenancy',
      monthsHeld: sensitivity.saleCompletionMonths,
      voidMonths: Math.max(0, userVoidMonths),
      salePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 'fast_forced',
      label: 'Fast forced sale',
      monthsHeld: Math.max(3, Math.min(sensitivity.saleCompletionMonths, monthsToTenancyEnd - 1)),
      voidMonths: Math.max(2, userVoidMonths + 2),
      salePrice: tenantedSalePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 'delay_dodge_erc',
      label: 'Delay past ERC',
      monthsHeld: Math.max(25, sensitivity.saleCompletionMonths),
      voidMonths: Math.max(0, userVoidMonths),
      salePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 're_let',
      label: 'Re-let, hold long term',
      monthsHeld: 24,
      voidMonths: Math.max(1, userVoidMonths),
      salePrice: new Decimal(0),
      sellingCosts: new Decimal(0),
      epcRemediation: new Decimal(0),
      resultsInSale: false,
    },
  ];
}

export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, isLoading } = useSWR<DecisionContextResponse>(
    `/api/properties/${id}/decision-context`,
    fetcher,
  );

  const [tab, setTab] = useState<'scenarios' | 'sensitivity' | 'sell_vs_hold'>('scenarios');
  const [products, setProducts] = useState<MortgageProduct[]>([]);
  const [sensitivity, setSensitivity] = useState<SensitivityState>(DEFAULT_SENSITIVITY);

  const context = useMemo<PropertyContext | null>(() => {
    if (!data) return null;
    const valuation = data.latestValuation
      ? new Decimal(data.latestValuation.valuation)
      : new Decimal(data.property.purchasePrice ?? '0');
    return {
      mortgageBalance: new Decimal(data.totalOutstandingBalance),
      latestValuation: valuation,
      acquisitionCost: new Decimal(data.property.purchasePrice ?? '0'),
      ownerCount: data.ownerCount || 1,
      annualRent: new Decimal(data.annualRent),
      annualRunningCosts: new Decimal(data.annualRunningCosts),
      marginalRatePct: new Decimal(sensitivity.marginalRatePct),
    };
  }, [data, sensitivity.marginalRatePct]);

  const scenarios = useMemo(
    () => buildScenarios(sensitivity, data?.activeTenancy?.endDate ?? null),
    [sensitivity, data?.activeTenancy?.endDate],
  );

  const validProducts = useMemo(
    () =>
      products.filter(
        p => p.name && p.ratePct && p.monthlyPayment && Number(p.monthlyPayment) > 0,
      ),
    [products],
  );

  const cells = useMemo(() => {
    if (!context || validProducts.length === 0) return [];
    return runScenarioComparison({ products: validProducts, scenarios, context });
  }, [validProducts, scenarios, context]);

  const stackedSeries = useMemo(() => buildStackedCostSeries(cells), [cells]);
  const breakEvenSeries = useMemo(() => {
    if (!context || validProducts.length === 0) return [];
    return buildBreakEvenSeries(validProducts, context.mortgageBalance, 36);
  }, [validProducts, context]);
  const matrix = useMemo(
    () => buildDecisionMatrix({ products: validProducts, cells }),
    [validProducts, cells],
  );
  const insights = useMemo(() => buildKeyInsights(cells), [cells]);
  const leadingErcSteps = useMemo(() => {
    if (validProducts.length === 0) return [];
    return validProducts[0].ercSchedule.map(t => t.untilMonth);
  }, [validProducts]);

  const monthsToTenancyEnd = (() => {
    if (!data?.activeTenancy?.endDate) return null;
    const today = new Date();
    const end = new Date(data.activeTenancy.endDate);
    return Math.max(
      0,
      Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30)),
    );
  })();

  if (isLoading) {
    return <Skeleton variant="rounded" height={400} />;
  }
  if (error || !data) {
    return <Alert severity="error">Could not load decision context for this property.</Alert>;
  }

  return (
    <Box>
      <Button
        component={Link}
        href={`/properties/${id}`}
        startIcon={<ArrowBackIcon />}
        sx={{ mb: 2 }}
      >
        Back to property
      </Button>

      <Typography variant="h4" sx={{ mb: 0.5 }}>
        Decision support
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {data.property.name}
        {data.property.address ? `, ${data.property.address}` : ''}
      </Typography>

      <DecisionDisclaimer />

      <ContextSummary
        data={data}
        marginalRatePct={sensitivity.marginalRatePct}
        onMarginalRateChange={r =>
          setSensitivity(s => ({ ...s, marginalRatePct: r }))
        }
      />

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Scenario explorer" value="scenarios" />
        <Tab label="Sensitivity" value="sensitivity" />
        <Tab label="Sell vs hold" value="sell_vs_hold" disabled />
      </Tabs>

      {tab === 'scenarios' && (
        <Box>
          <MortgageProductForm products={products} onChange={setProducts} />
          <ScenarioCards cells={cells} />
        </Box>
      )}

      {tab === 'sensitivity' && (
        <Box>
          <SensitivityControls value={sensitivity} onChange={setSensitivity} />
          <MortgageProductForm products={products} onChange={setProducts} />
          <KeyInsights insights={insights} />
          <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid size={{ xs: 12 }}>
                <TimelineChart
                  tenancyEndsMonth={monthsToTenancyEnd}
                  saleCompletionMonth={sensitivity.saleCompletionMonths}
                  ercStepMonths={leadingErcSteps}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <CostBreakdownChart series={stackedSeries} />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <BreakEvenChart
                  series={breakEvenSeries}
                  saleCompletionMonth={sensitivity.saleCompletionMonths}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <DecisionMatrix matrix={matrix} />
              </Grid>
            </Grid>
          </Suspense>
        </Box>
      )}
    </Box>
  );
}

function ContextSummary({
  data,
  marginalRatePct,
  onMarginalRateChange,
}: {
  data: DecisionContextResponse;
  marginalRatePct: '20' | '40' | '45';
  onMarginalRateChange: (value: '20' | '40' | '45') => void;
}) {
  const items: Array<{ label: string; value: string }> = [
    {
      label: 'Latest valuation',
      value: data.latestValuation
        ? `£${Number(data.latestValuation.valuation).toLocaleString()}`
        : '—',
    },
    {
      label: 'Outstanding mortgage',
      value: `£${Number(data.totalOutstandingBalance).toLocaleString()}`,
    },
    {
      label: 'Annual rent',
      value: `£${Number(data.annualRent).toLocaleString()}`,
    },
    {
      label: 'Owners',
      value: `${data.ownerCount}`,
    },
  ];
  return (
    <Stack
      direction={{ xs: 'column', sm: 'row' }}
      spacing={2}
      sx={{ mb: 2, p: 2, border: 1, borderColor: 'divider', borderRadius: 2 }}
      useFlexGap
      flexWrap="wrap"
    >
      {items.map(item => (
        <Box key={item.label}>
          <Typography variant="caption" color="text.secondary">
            {item.label}
          </Typography>
          <Typography variant="subtitle1" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums' }}>
            {item.value}
          </Typography>
        </Box>
      ))}
      <Box>
        <Typography variant="caption" color="text.secondary">
          Marginal tax rate
        </Typography>
        <select
          value={marginalRatePct}
          onChange={e => onMarginalRateChange(e.target.value as '20' | '40' | '45')}
          style={{ display: 'block', marginTop: 4, padding: '4px 8px', borderRadius: 4 }}
        >
          <option value="20">Basic 20%</option>
          <option value="40">Higher 40%</option>
          <option value="45">Additional 45%</option>
        </select>
      </Box>
    </Stack>
  );
}
