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

const fetcher = (url: string) => fetch(url).then(r => r.json());

/**
 * Compact card showing mortgage interest paid this and last UK tax year for
 * a property. The figure goes through the same tax-year report endpoint as
 * the full report so totals can never drift between the two views.
 */
export default function MortgageInterestSummary({ propertyId }: { propertyId: number }) {
  const thisYear = currentTaxYear();
  const lastYear = taxYearRange(thisYear.startYear - 1);

  const { data: thisYearReport, isLoading: thisLoading } = useSWR<ReportResponse>(
    `/api/properties/${propertyId}/tax-year-report?year=${thisYear.label}`,
    fetcher,
  );
  const { data: lastYearReport, isLoading: lastLoading } = useSWR<ReportResponse>(
    `/api/properties/${propertyId}/tax-year-report?year=${lastYear.label}`,
    fetcher,
  );

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Typography variant="h6" gutterBottom>Mortgage interest (S.24)</Typography>

        <Stack direction="row" spacing={3}>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">
              This tax year ({thisYear.label})
            </Typography>
            {thisLoading ? (
              <Skeleton width={80} height={28} />
            ) : (
              <Typography variant="h6">
                {formatCurrency(thisYearReport?.totals?.mortgageInterest ?? '0')}
              </Typography>
            )}
          </Box>
          <Box flex={1}>
            <Typography variant="caption" color="text.secondary">
              Last tax year ({lastYear.label})
            </Typography>
            {lastLoading ? (
              <Skeleton width={80} height={28} />
            ) : (
              <Typography variant="h6">
                {formatCurrency(lastYearReport?.totals?.mortgageInterest ?? '0')}
              </Typography>
            )}
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
