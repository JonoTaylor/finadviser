'use client';

import { useMemo, useState, use } from 'react';
import Link from 'next/link';
import {
  Alert,
  Box,
  Button,
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
import {
  runScenarioComparison,
  type MortgageProduct,
  type PropertyContext,
  type ScenarioInputs,
} from '@/lib/properties/btl-decision';

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

function defaultScenarios(activeTenancyEnd: string | null): ScenarioInputs[] {
  // Months until the active tenancy ends (or 12 if unknown / open-ended).
  // ride_out runs to natural end; fast_forced cuts it short; delay_dodge_erc
  // pushes past month 24 to clear a typical Y2 ERC; re_let runs the full
  // chosen-product term.
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
  const defaultSalePrice = new Decimal(450000);

  return [
    {
      key: 'ride_out',
      label: 'Ride out tenancy',
      monthsHeld: monthsToTenancyEnd + 2,
      voidMonths: 1,
      salePrice: defaultSalePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: new Decimal(0),
      resultsInSale: true,
    },
    {
      key: 'fast_forced',
      label: 'Fast forced sale',
      monthsHeld: Math.max(4, monthsToTenancyEnd - 2),
      voidMonths: 3,
      salePrice: defaultSalePrice.mul(new Decimal('0.95')), // ~5% tenanted-sale discount
      sellingCosts: baseSellingCosts,
      epcRemediation: new Decimal(0),
      resultsInSale: true,
    },
    {
      key: 'delay_dodge_erc',
      label: 'Delay past ERC',
      monthsHeld: 25,
      voidMonths: 2,
      salePrice: defaultSalePrice,
      sellingCosts: baseSellingCosts,
      epcRemediation: new Decimal(0),
      resultsInSale: true,
    },
    {
      key: 're_let',
      label: 'Re-let, hold long term',
      monthsHeld: 24,
      voidMonths: 1,
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
  const [marginalRatePct, setMarginalRatePct] = useState('40');

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
      marginalRatePct: new Decimal(marginalRatePct),
    };
  }, [data, marginalRatePct]);

  const scenarios = useMemo(
    () => defaultScenarios(data?.activeTenancy?.endDate ?? null),
    [data?.activeTenancy?.endDate],
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

      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 2 }}>
        <Tab label="Scenario explorer" value="scenarios" />
        <Tab label="Sensitivity" value="sensitivity" disabled />
        <Tab label="Sell vs hold" value="sell_vs_hold" disabled />
      </Tabs>

      {tab === 'scenarios' && (
        <Box>
          <ContextSummary
            data={data}
            marginalRatePct={marginalRatePct}
            onMarginalRateChange={setMarginalRatePct}
          />
          <MortgageProductForm products={products} onChange={setProducts} />
          <ScenarioCards cells={cells} />
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
  marginalRatePct: string;
  onMarginalRateChange: (value: string) => void;
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
          onChange={e => onMarginalRateChange(e.target.value)}
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
