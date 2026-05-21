'use client';

import { useMemo, useState, use, lazy, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
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
const SellVsHoldPanel = lazy(
  () => import('@/components/properties/decision/SellVsHoldPanel'),
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
  mortgages: Array<{
    id: number;
    lender: string;
    outstandingBalance: string;
    interestOnly: boolean;
    rates: Array<{ rate: string; effectiveDate: string }>;
  }>;
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

// Shared assumptions used by both the scenario engine and the Sell-vs-Hold
// projection so all three tabs reason about the same numbers.
const BASE_SELLING_COSTS_GBP = new Decimal(8000);
const FALLBACK_MORTGAGE_RATE_PCT = new Decimal('5.49');

/**
 * Pick the latest in-effect rate across a property's mortgages,
 * weighted by outstanding balance. Falls back to `FALLBACK_MORTGAGE_RATE_PCT`
 * when no rate history is available (e.g. a freshly added mortgage).
 */
function currentBlendedMortgageRatePct(
  mortgages: DecisionContextResponse['mortgages'],
): Decimal {
  if (!mortgages || mortgages.length === 0) return FALLBACK_MORTGAGE_RATE_PCT;
  let weightedRate = new Decimal(0);
  let totalBalance = new Decimal(0);
  for (const m of mortgages) {
    const sortedRates = [...m.rates].sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const latest = sortedRates[0];
    if (!latest) continue;
    const balance = new Decimal(m.outstandingBalance);
    weightedRate = weightedRate.plus(new Decimal(latest.rate).mul(balance));
    totalBalance = totalBalance.plus(balance);
  }
  return totalBalance.gt(0) ? weightedRate.div(totalBalance) : FALLBACK_MORTGAGE_RATE_PCT;
}

/**
 * Months between today and `endDate`. Returns null for open-ended
 * tenancies. Shared between `buildScenarios` and the timeline so the
 * tenancy-end value the chart shows matches the one the scenario
 * engine derives.
 */
function monthsUntil(endDate: string | null): number | null {
  if (!endDate) return null;
  const today = new Date();
  const end = new Date(endDate);
  return Math.max(
    0,
    Math.ceil((end.getTime() - today.getTime()) / (1000 * 60 * 60 * 24 * 30)),
  );
}

function buildScenarios(
  sensitivity: SensitivityState,
  activeTenancyEnd: string | null,
): ScenarioInputs[] {
  // 12 months when the tenancy is open-ended OR has already ended.
  const monthsToTenancyEnd = Math.max(1, monthsUntil(activeTenancyEnd) ?? 12);

  const baseSellingCosts = BASE_SELLING_COSTS_GBP;
  const salePrice = new Decimal(sensitivity.salePrice);
  const tenantedSalePrice = salePrice.mul(
    new Decimal(100 - sensitivity.tenantedSaleDiscountPct).div(100),
  );
  const epc = new Decimal(sensitivity.epcRemediation);
  const userVoidMonths = sensitivity.voidMonths;

  // Void months can never exceed the holding period (you can't sit
  // empty for 12 months on a 3-month hold). Clamping here keeps carry
  // costs physically possible regardless of slider combinations.
  const scenarios: Array<Omit<ScenarioInputs, 'voidMonths'> & { voidMonthsRaw: number }> = [
    {
      key: 'ride_out',
      label: 'Ride out tenancy',
      monthsHeld: sensitivity.saleCompletionMonths,
      voidMonthsRaw: Math.max(0, userVoidMonths),
      salePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 'fast_forced',
      label: 'Fast forced sale',
      monthsHeld: Math.max(3, Math.min(sensitivity.saleCompletionMonths, monthsToTenancyEnd - 1)),
      voidMonthsRaw: Math.max(2, userVoidMonths + 2),
      salePrice: tenantedSalePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 'delay_dodge_erc',
      label: 'Delay past ERC',
      monthsHeld: Math.max(25, sensitivity.saleCompletionMonths),
      voidMonthsRaw: Math.max(0, userVoidMonths),
      salePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: epc,
      resultsInSale: true,
    },
    {
      key: 're_let',
      label: 'Re-let, hold long term',
      monthsHeld: 24,
      voidMonthsRaw: Math.max(1, userVoidMonths),
      salePrice: new Decimal(0),
      sellingCosts: new Decimal(0),
      epcRemediation: new Decimal(0),
      resultsInSale: false,
    },
  ];

  return scenarios.map(({ voidMonthsRaw, ...rest }) => ({
    ...rest,
    voidMonths: Math.min(voidMonthsRaw, rest.monthsHeld),
  }));
}

export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const isPrintMode = searchParams?.get('print') === '1';

  const { data, error, isLoading } = useSWR<DecisionContextResponse>(
    `/api/properties/${id}/decision-context`,
    fetcher,
  );

  const [tab, setTab] = useState<'scenarios' | 'sensitivity' | 'sell_vs_hold'>('scenarios');
  const [products, setProducts] = useState<MortgageProduct[]>([]);
  const [sensitivity, setSensitivity] = useState<SensitivityState>(DEFAULT_SENSITIVITY);

  const handleProductsChange = (next: MortgageProduct[]) => {
    setProducts(next);
  };

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

  // ERC step months should match whichever product is actually leading
  // the comparison under the current sensitivity inputs, not whichever
  // product the user happened to type first. Pick the leader from the
  // `ride_out` scenario (the headline plan) and read its schedule.
  const leadingErcSteps = useMemo(() => {
    const rideOutCells = cells.filter(c => c.scenarioKey === 'ride_out');
    if (rideOutCells.length === 0) return [];
    const leader = rideOutCells.reduce((best, c) =>
      c.result.totalCarryCost.lt(best.result.totalCarryCost) ? c : best,
    );
    const leaderProduct = validProducts.find(p => p.id === leader.productId);
    return leaderProduct?.ercSchedule.map(t => t.untilMonth) ?? [];
  }, [cells, validProducts]);

  const monthsToTenancyEnd = monthsUntil(data?.activeTenancy?.endDate ?? null);

  if (isLoading) {
    return <Skeleton variant="rounded" height={400} />;
  }
  if (error || !data) {
    return <Alert severity="error">Could not load decision context for this property.</Alert>;
  }

  return (
    <Box>
      {!isPrintMode && (
        <Button
          component={Link}
          href={`/properties/${id}`}
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 2 }}
        >
          Back to property
        </Button>
      )}

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
        showMarginalRateControl={tab !== 'sensitivity'}
      />

      {!isPrintMode && (
        <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
          <Tab label="Scenario explorer" value="scenarios" />
          <Tab label="Sensitivity" value="sensitivity" />
          <Tab label="Sell vs hold" value="sell_vs_hold" />
        </Tabs>
      )}

      {(tab === 'scenarios' || isPrintMode) && (
        <Box>
          {!isPrintMode && (
            <MortgageProductForm products={products} onChange={handleProductsChange} />
          )}
          <ScenarioCards cells={cells} />
        </Box>
      )}

      {(tab === 'sensitivity' || isPrintMode) && (
        <Box>
          {!isPrintMode && (
            <SensitivityControls value={sensitivity} onChange={setSensitivity} />
          )}
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

      {(tab === 'sell_vs_hold' || isPrintMode) && context && (
        <Box>
          <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
            <SellVsHoldPanel
              context={context}
              annualMortgageInterest={context.mortgageBalance
                .mul(currentBlendedMortgageRatePct(data.mortgages))
                .div(100)}
              defaultSalePrice={new Decimal(sensitivity.salePrice)}
              sellingCosts={BASE_SELLING_COSTS_GBP}
            />
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
  showMarginalRateControl,
}: {
  data: DecisionContextResponse;
  marginalRatePct: '20' | '40' | '45';
  onMarginalRateChange: (value: '20' | '40' | '45') => void;
  showMarginalRateControl: boolean;
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
      {showMarginalRateControl && (
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
      )}
    </Stack>
  );
}
