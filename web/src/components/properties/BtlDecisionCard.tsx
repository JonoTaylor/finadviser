'use client';

import type { ReactNode } from 'react';
import useSWR from 'swr';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  Divider,
  Grid,
  Skeleton,
  Stack,
  Typography,
} from '@mui/material';
import AccountBalanceWalletOutlinedIcon from '@mui/icons-material/AccountBalanceWalletOutlined';
import PercentOutlinedIcon from '@mui/icons-material/PercentOutlined';
import TrendingUpOutlinedIcon from '@mui/icons-material/TrendingUpOutlined';
import { formatCurrency, formatPercentage } from '@/lib/utils/formatting';

interface ProfitabilityWarning {
  code: string;
  message: string;
}

interface ProfitabilityResponse {
  taxYear: { label: string; startDate: string; endDate: string };
  taxProfitEstimate: {
    rentIncome: string;
    otherIncome: string;
    grossIncome: string;
    deductibleExpenses: string;
    taxableRentalProfit: string;
    mortgageInterestForRelief: string;
    estimatedTaxDue: string;
    assumptions: {
      incomeTaxRatePct: string;
      mortgageInterestReliefRatePct: string;
      usingDefaultIncomeTaxRate: boolean;
      usingDefaultMortgageInterestReliefRate: boolean;
    };
  };
  cashFlowBeforeTax: {
    grossIncome: string;
    deductibleExpenses: string;
    mortgagePayments: string;
    annual: string;
    monthly: string;
  };
  cashFlowAfterTax: {
    estimatedTaxDue: string;
    annual: string;
    monthly: string;
  };
  equityReturn: {
    propertyValue: string;
    mortgageBalance: string;
    equity: string;
    returnOnEquityPct: string | null;
    netYieldPct: string | null;
  };
  stressTests: {
    vacancyOneMonth: { label: string; monthlyCashFlowAfterTax: string };
    mortgagePaymentsUp10Pct: { label: string; monthlyCashFlowAfterTax: string } | null;
  };
  warnings: ProfitabilityWarning[];
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.json();
};

export default function BtlDecisionCard({ propertyId }: { propertyId: number }) {
  const { data, error, isLoading } = useSWR<ProfitabilityResponse>(
    `/api/properties/${propertyId}/profitability`,
    fetcher,
  );

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1} sx={{ mb: 1 }}>
          <Box>
            <Typography variant="h6">BTL decision summary</Typography>
            <Typography variant="body2" color="text.secondary">
              Separates bank cash flow, taxable rental profit and equity return.
            </Typography>
          </Box>
          {data?.taxYear?.label && <Chip size="small" label={data.taxYear.label} variant="outlined" />}
        </Stack>

        {isLoading ? (
          <Skeleton variant="rounded" height={230} />
        ) : error || !data ? (
          <Alert severity="warning">Could not load the profitability summary.</Alert>
        ) : (
          <Stack spacing={2}>
            {data.warnings.map(warning => (
              <Alert key={warning.code} severity="warning">
                {warning.message}
              </Alert>
            ))}

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip
                size="small"
                variant="outlined"
                color={data.taxProfitEstimate.assumptions.usingDefaultIncomeTaxRate ? 'warning' : 'default'}
                label={`Income tax assumption: ${formatPct(data.taxProfitEstimate.assumptions.incomeTaxRatePct)}`}
              />
              <Chip
                size="small"
                variant="outlined"
                color={data.taxProfitEstimate.assumptions.usingDefaultMortgageInterestReliefRate ? 'warning' : 'default'}
                label={`Mortgage interest relief: ${formatPct(data.taxProfitEstimate.assumptions.mortgageInterestReliefRatePct)}`}
              />
            </Stack>

            <Grid container spacing={1.5}>
              <HeadlineMetric
                icon={<AccountBalanceWalletOutlinedIcon color="primary" />}
                label="Monthly cash flow after tax"
                value={formatCurrency(data.cashFlowAfterTax.monthly)}
                helper="Cash left in the bank after expenses, full recorded mortgage payments and estimated tax."
              />
              <HeadlineMetric
                icon={<PercentOutlinedIcon color="primary" />}
                label="Net yield"
                value={formatPct(data.equityReturn.netYieldPct)}
                helper="Rent plus other income, less deductible running costs, divided by property value."
              />
              <HeadlineMetric
                icon={<TrendingUpOutlinedIcon color="primary" />}
                label="Return on equity"
                value={formatPct(data.equityReturn.returnOnEquityPct)}
                helper="Annual after-tax cash flow divided by your equity in the property."
              />
            </Grid>

            <Divider />

            <Stack spacing={1}>
              <Explainer
                title="Cash left in the bank"
                body={`Annual cash flow after tax is ${formatCurrency(data.cashFlowAfterTax.annual)}. This subtracts recorded mortgage payments in full (${formatCurrency(data.cashFlowBeforeTax.mortgagePayments)}), not just the interest element.`}
              />
              <Explainer
                title="Taxable rental profit"
                body={`Taxable rental profit is ${formatCurrency(data.taxProfitEstimate.taxableRentalProfit)} before mortgage-interest relief. It includes rent and other income, deducts allowable expenses, and shows mortgage interest separately (${formatCurrency(data.taxProfitEstimate.mortgageInterestForRelief)}) for relief assumptions.`}
              />
              <Explainer
                title="Return on equity"
                body={`Equity is estimated at ${formatCurrency(data.equityReturn.equity)} after mortgage balances. Return on equity asks whether the cash return justifies the capital tied up, not just whether the tax report shows a profit.`}
              />
            </Stack>

            <Divider />

            <Box>
              <Typography variant="subtitle2" gutterBottom>Stress tests</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                <StressPill
                  label={data.stressTests.vacancyOneMonth.label}
                  value={formatCurrency(data.stressTests.vacancyOneMonth.monthlyCashFlowAfterTax)}
                />
                {data.stressTests.mortgagePaymentsUp10Pct && (
                  <StressPill
                    label={data.stressTests.mortgagePaymentsUp10Pct.label}
                    value={formatCurrency(data.stressTests.mortgagePaymentsUp10Pct.monthlyCashFlowAfterTax)}
                  />
                )}
              </Stack>
            </Box>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

function HeadlineMetric({
  icon,
  label,
  value,
  helper,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  helper: string;
}) {
  return (
    <Grid size={{ xs: 12, sm: 4 }}>
      <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, p: 1.5, height: '100%' }}>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
          {icon}
          <Typography variant="caption" color="text.secondary">{label}</Typography>
        </Stack>
        <Typography variant="h5" fontWeight={700}>{value}</Typography>
        <Typography variant="caption" color="text.secondary">{helper}</Typography>
      </Box>
    </Grid>
  );
}

function Explainer({ title, body }: { title: string; body: string }) {
  return (
    <Box>
      <Typography variant="subtitle2">{title}</Typography>
      <Typography variant="body2" color="text.secondary">{body}</Typography>
    </Box>
  );
}

function StressPill({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, px: 1.5, py: 1 }}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant="subtitle1" fontWeight={700}>{value} / month</Typography>
    </Box>
  );
}

function formatPct(value: string | null): string {
  return value == null ? '—' : formatPercentage(Number(value), 1);
}
