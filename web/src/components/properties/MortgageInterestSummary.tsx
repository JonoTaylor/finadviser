'use client';

import useSWR from 'swr';
import { Card, CardContent, Typography, Stack, Box, Skeleton } from '@mui/material';
import { formatCurrency } from '@/lib/utils/formatting';
import { currentTaxYear, taxYearRange } from '@/lib/tax/ukTaxYear';

interface ReportTotals {
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
  netBeforeMortgageRelief: string;
}

interface ReportResponse {
  totals: ReportTotals;
}

// Throw on non-OK so SWR puts the failure into `error` instead of letting
// the response body render as a "successful" zero figure.
const fetcher = async (url: string): Promise<ReportResponse> => {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  }
  return res.json();
};

/**
 * Compact card showing mortgage interest paid this and last UK tax year for
 * a property. The figure goes through the same tax-year report endpoint as
 * the full report so totals can never drift between the two views.
 *
 * On a failed fetch we render an em-dash, not £0.00 — a zero balance is a
 * legitimate value (the property may genuinely have had no interest charged
 * this year) and we don't want to mislead the user.
 */
export default function MortgageInterestSummary({ propertyId }: { propertyId: number }) {
  const thisYear = currentTaxYear();
  const lastYear = taxYearRange(thisYear.startYear - 1);

  // summary=true returns just the totals — line arrays are stripped from
  // the response since this card only needs `mortgageInterest`.
  const { data: thisYearReport, error: thisError, isLoading: thisLoading } = useSWR<ReportResponse>(
    `/api/properties/${propertyId}/tax-year-report?year=${thisYear.label}&summary=true`,
    fetcher,
  );
  const { data: lastYearReport, error: lastError, isLoading: lastLoading } = useSWR<ReportResponse>(
    `/api/properties/${propertyId}/tax-year-report?year=${lastYear.label}&summary=true`,
    fetcher,
  );

  const renderAmount = (
    loading: boolean,
    err: unknown,
    value: string | undefined,
  ) => {
    if (loading) return <Skeleton width={80} height={28} />;
    if (err) {
      return (
        <Typography variant="h6" color="text.disabled" title="Could not load">
          —
        </Typography>
      );
    }
    return <Typography variant="h6">{formatCurrency(value ?? '0')}</Typography>;
  };

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Mortgage interest (S.24)</Typography>

        <Stack direction="row" spacing={3}>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">
              This tax year ({thisYear.label})
            </Typography>
            {renderAmount(thisLoading, thisError, thisYearReport?.totals?.mortgageInterest)}
          </Box>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">
              Last tax year ({lastYear.label})
            </Typography>
            {renderAmount(lastLoading, lastError, lastYearReport?.totals?.mortgageInterest)}
          </Box>
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Tracked but restricted to basic-rate (20%) relief under S.24 — not deducted as
          an ordinary expense. Aggregated across all mortgages tagged to this property.
        </Typography>
      </CardContent>
    </Card>
  );
}
