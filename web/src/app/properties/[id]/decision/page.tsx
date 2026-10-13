'use client';

import { useMemo, useRef, useState, use, lazy, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
  Chip,
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
  salePriceRangeFromValuation,
  type SalePriceRange,
  type SensitivityState,
} from '@/components/properties/decision/SensitivityControls';
import KeyInsights from '@/components/properties/decision/KeyInsights';
import {
  buildBreakEvenSeries,
  buildDecisionMatrix,
  buildKeyInsights,
  buildStackedCostSeries,
  runScenarioComparison,
  type ComparisonCell,
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

interface SavedProductsResponse {
  products: Array<{
    id: number;
    name: string;
    productType: string;
    ratePct: string;
    productFee: string;
    exitFee: string;
    monthlyPayment: string;
    ercSchedule: Array<{ untilMonth: number; pct: string }>;
  }>;
}

const BASE_SELLING_COSTS_GBP = new Decimal(8000);
const FALLBACK_MORTGAGE_RATE_PCT = new Decimal('5.49');

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
  const monthsToTenancyEnd = Math.max(1, monthsUntil(activeTenancyEnd) ?? 12);

  const baseSellingCosts = BASE_SELLING_COSTS_GBP;
  const salePrice = new Decimal(sensitivity.salePrice);
  const tenantedSalePrice = salePrice.mul(
    new Decimal(100 - sensitivity.tenantedSaleDiscountPct).div(100),
  );
  const epc = new Decimal(sensitivity.epcRemediation);
  const userVoidMonths = sensitivity.voidMonths;

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

/**
 * Map server-side saved products onto the in-memory `MortgageProduct`
 * shape. The form uses string IDs (UUIDs for unsaved rows, the numeric
 * server ID stringified for saved rows) so the inner component can
 * tell which is which when persisting.
 */
function mapSavedToProducts(saved: SavedProductsResponse['products']): MortgageProduct[] {
  return saved.map(p => ({
    id: String(p.id),
    name: p.name,
    type: p.productType as MortgageProduct['type'],
    ratePct: p.ratePct,
    productFee: p.productFee,
    exitFee: p.exitFee,
    monthlyPayment: p.monthlyPayment,
    ercSchedule: p.ercSchedule ?? [],
  }));
}

/**
 * Find the leading product across `ride_out` cells (lowest total carry
 * cost). Used by the Sell-vs-Hold panel so the hold-path interest is
 * derived from whichever product you'd actually switch to, not a
 * blended DB rate. Returns null when no products are entered yet.
 */
function findLeadingProduct(
  cells: ComparisonCell[],
  products: MortgageProduct[],
): MortgageProduct | null {
  const rideOut = cells.filter(c => c.scenarioKey === 'ride_out');
  if (rideOut.length === 0) return null;
  const leaderCell = rideOut.reduce((best, c) =>
    c.result.totalCarryCost.lt(best.result.totalCarryCost) ? c : best,
  );
  return products.find(p => p.id === leaderCell.productId) ?? null;
}

export default function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);

  const { data: context, error: contextError, isLoading: contextLoading } =
    useSWR<DecisionContextResponse>(
      `/api/properties/${id}/decision-context`,
      fetcher,
    );
  const { data: savedProducts, error: productsError, isLoading: productsLoading } =
    useSWR<SavedProductsResponse>(
      `/api/properties/${id}/decision-products`,
      fetcher,
    );

  if (contextLoading || productsLoading) {
    return <Skeleton variant="rounded" height={400} />;
  }
  if (contextError || productsError || !context || !savedProducts) {
    return <Alert severity="error">Could not load decision context for this property.</Alert>;
  }

  // Split the page into outer (data-loading) and inner (interactive)
  // shells. Once SWR delivers both responses, mount the inner with the
  // saved products as the initial value of its local state. The outer
  // never re-mounts the inner on subsequent SWR revalidations, so the
  // user's in-progress edits aren't blown away by background refreshes.
  return (
    <DecisionPageInner
      pathId={id}
      context={context}
      initialProducts={mapSavedToProducts(savedProducts.products)}
    />
  );
}

function DecisionPageInner({
  pathId,
  context: data,
  initialProducts,
}: {
  pathId: string;
  context: DecisionContextResponse;
  initialProducts: MortgageProduct[];
}) {
  const searchParams = useSearchParams();
  const isPrintMode = searchParams?.get('print') === '1';

  const valuationNumber = data.latestValuation
    ? Number(data.latestValuation.valuation)
    : Number(data.property.purchasePrice ?? 0) || 400_000;
  const salePriceRange = useMemo<SalePriceRange>(
    () => salePriceRangeFromValuation(valuationNumber),
    [valuationNumber],
  );

  const [tab, setTab] = useState<'scenarios' | 'sensitivity' | 'sell_vs_hold'>('scenarios');
  const [products, setProducts] = useState<MortgageProduct[]>(initialProducts);
  const [sensitivity, setSensitivity] = useState<SensitivityState>(() => ({
    ...DEFAULT_SENSITIVITY,
    salePrice: salePriceRange.default,
  }));
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // Track per-row pending save timers so rapid edits to the same row
  // coalesce into one PATCH instead of one per keystroke. The map key
  // is the client-side product id; values are setTimeout handles.
  const pendingTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const persistProduct = async (product: MortgageProduct, previousId?: string) => {
    setSaveStatus('saving');
    try {
      const isPersisted = /^\d+$/.test(product.id);
      if (isPersisted) {
        const res = await fetch(
          `/api/properties/${pathId}/decision-products/${product.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: product.name,
              productType: product.type,
              ratePct: product.ratePct,
              productFee: product.productFee,
              exitFee: product.exitFee,
              monthlyPayment: product.monthlyPayment,
              ercSchedule: product.ercSchedule,
            }),
          },
        );
        if (!res.ok) throw new Error(`PATCH ${res.status}`);
      } else if (
        product.name &&
        product.ratePct &&
        product.monthlyPayment &&
        Number(product.monthlyPayment) > 0
      ) {
        const res = await fetch(`/api/properties/${pathId}/decision-products`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: product.name,
            productType: product.type,
            ratePct: product.ratePct,
            productFee: product.productFee,
            exitFee: product.exitFee,
            monthlyPayment: product.monthlyPayment,
            ercSchedule: product.ercSchedule,
          }),
        });
        if (!res.ok) throw new Error(`POST ${res.status}`);
        const body = await res.json();
        const newId = String(body.product.id);
        // Re-key the row so subsequent edits go through PATCH against
        // the persisted ID instead of creating duplicates.
        setProducts(prev =>
          prev.map(p => (p.id === (previousId ?? product.id) ? { ...p, id: newId } : p)),
        );
      }
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  };

  const archiveProduct = async (productId: string) => {
    if (!/^\d+$/.test(productId)) return;
    setSaveStatus('saving');
    try {
      const res = await fetch(
        `/api/properties/${pathId}/decision-products/${productId}`,
        { method: 'DELETE' },
      );
      if (!res.ok) throw new Error(`DELETE ${res.status}`);
      setSaveStatus('saved');
    } catch {
      setSaveStatus('error');
    }
  };

  const handleProductsChange = (next: MortgageProduct[]) => {
    const prevById = new Map(products.map(p => [p.id, p]));
    const nextIds = new Set(next.map(p => p.id));
    setProducts(next);

    // Per-row coalescing: schedule a save 300ms after the last change
    // to the same row, cancelling any prior pending save for that row.
    for (const product of next) {
      const prev = prevById.get(product.id);
      if (!prev || JSON.stringify(prev) === JSON.stringify(product)) continue;
      const existingTimer = pendingTimers.current.get(product.id);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        pendingTimers.current.delete(product.id);
        void persistProduct(product, product.id);
      }, 300);
      pendingTimers.current.set(product.id, timer);
    }

    // Removed rows fire DELETE immediately (no need to coalesce a delete).
    for (const prev of products) {
      if (!nextIds.has(prev.id)) {
        const t = pendingTimers.current.get(prev.id);
        if (t) {
          clearTimeout(t);
          pendingTimers.current.delete(prev.id);
        }
        void archiveProduct(prev.id);
      }
    }
  };

  const propertyContext = useMemo<PropertyContext>(
    () => ({
      mortgageBalance: new Decimal(data.totalOutstandingBalance),
      latestValuation: new Decimal(valuationNumber),
      acquisitionCost: new Decimal(data.property.purchasePrice ?? '0'),
      ownerCount: data.ownerCount || 1,
      annualRent: new Decimal(data.annualRent),
      annualRunningCosts: new Decimal(data.annualRunningCosts),
      marginalRatePct: new Decimal(sensitivity.marginalRatePct),
    }),
    [data, valuationNumber, sensitivity.marginalRatePct],
  );

  const scenarios = useMemo(
    () => buildScenarios(sensitivity, data.activeTenancy?.endDate ?? null),
    [sensitivity, data.activeTenancy?.endDate],
  );

  const validProducts = useMemo(
    () =>
      products.filter(
        p => p.name && p.ratePct && p.monthlyPayment && Number(p.monthlyPayment) > 0,
      ),
    [products],
  );

  const cells = useMemo(() => {
    if (validProducts.length === 0) return [];
    return runScenarioComparison({ products: validProducts, scenarios, context: propertyContext });
  }, [validProducts, scenarios, propertyContext]);

  const stackedSeries = useMemo(() => buildStackedCostSeries(cells), [cells]);
  const breakEvenSeries = useMemo(() => {
    if (validProducts.length === 0) return [];
    return buildBreakEvenSeries(validProducts, propertyContext.mortgageBalance, 36);
  }, [validProducts, propertyContext]);
  const matrix = useMemo(
    () => buildDecisionMatrix({ products: validProducts, cells }),
    [validProducts, cells],
  );
  const insights = useMemo(() => buildKeyInsights(cells), [cells]);

  const leadingProduct = useMemo(
    () => findLeadingProduct(cells, validProducts),
    [cells, validProducts],
  );

  const leadingErcSteps = useMemo(
    () => leadingProduct?.ercSchedule.map(t => t.untilMonth) ?? [],
    [leadingProduct],
  );

  // For the Sell-vs-Hold projection we want the hold-path interest to
  // reflect whichever product you'd actually switch to. If you've got
  // products entered, use the leading one's rate. Otherwise fall back
  // to the blended DB rate across the actual mortgages on file.
  const annualMortgageInterest = useMemo(() => {
    if (leadingProduct?.ratePct) {
      const rate = new Decimal(leadingProduct.ratePct);
      return propertyContext.mortgageBalance.mul(rate).div(100);
    }
    return propertyContext.mortgageBalance
      .mul(currentBlendedMortgageRatePct(data.mortgages))
      .div(100);
  }, [leadingProduct, propertyContext, data.mortgages]);

  const monthsToTenancyEnd = monthsUntil(data.activeTenancy?.endDate ?? null);

  return (
    <Box>
      {!isPrintMode && (
        <Button
          component={Link}
          href={`/properties/${pathId}`}
          startIcon={<ArrowBackIcon />}
          sx={{ mb: 2 }}
        >
          Back to property
        </Button>
      )}

      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
        <Typography variant="h4">Decision support</Typography>
        {!isPrintMode && <SaveStatusChip status={saveStatus} />}
      </Stack>
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
            <SensitivityControls
              value={sensitivity}
              onChange={setSensitivity}
              salePriceRange={salePriceRange}
            />
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

      {(tab === 'sell_vs_hold' || isPrintMode) && (
        <Box>
          <Suspense fallback={<Skeleton variant="rounded" height={320} />}>
            <SellVsHoldPanel
              context={propertyContext}
              annualMortgageInterest={annualMortgageInterest}
              defaultSalePrice={new Decimal(sensitivity.salePrice)}
              sellingCosts={BASE_SELLING_COSTS_GBP}
              leadingProductLabel={leadingProduct?.name ?? null}
            />
          </Suspense>
        </Box>
      )}

    </Box>
  );
}

function SaveStatusChip({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'idle') return null;
  if (status === 'saving') return <Chip size="small" label="Saving…" />;
  if (status === 'saved') return <Chip size="small" label="Saved" color="success" variant="outlined" />;
  return <Chip size="small" label="Save failed" color="error" />;
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
