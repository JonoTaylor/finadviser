'use client';

import useSWR, { type SWRResponse } from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Box,
  Skeleton,
  Tooltip,
  Chip,
  Divider,
  Alert,
} from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
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

interface SummaryResponse {
  taxYear: string;
  totalInterest: string;
  basicRateCredit: string;
  totalDays: number;
  uncoveredDays: number;
  perMortgage: Array<{
    mortgageId: number;
    lender: string;
    interestOnly: boolean;
    principalUsed: string;
    totalInterest: string;
    totalDays: number;
    uncoveredDays: number;
  }>;
}

const fetcher = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url} (HTTP ${res.status})`);
  return res.json();
};

/**
 * Compact card showing mortgage interest paid this and last UK tax year,
 * comparing the journal-recorded value against an interest figure
 * computed from the rate history. The 20% basic-rate credit (S.24) is
 * shown next to each so the user sees the actual tax saving in plain
 * English.
 *
 * On a failed fetch we render an em-dash, not £0.00 — a zero balance is
 * a legitimate value (the property may genuinely have had no interest
 * charged this year) and we don't want to mislead the user.
 */
export default function MortgageInterestSummary({ propertyId }: { propertyId: number }) {
  const thisYear = currentTaxYear();
  const lastYear = taxYearRange(thisYear.startYear - 1);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
          <Typography variant="h6">Mortgage interest (S.24)</Typography>
          <Tooltip
            arrow
            title="Recorded = sum of journals against the Mortgage Interest expense account. Computed = principal × rate × days/365 across each rate sub-period in the rate history. The two should agree once you've recorded every payment for the year."
          >
            <InfoOutlinedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
          </Tooltip>
        </Stack>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <YearColumn label={`This tax year (${thisYear.label})`} year={thisYear.label} propertyId={propertyId} />
          <Divider orientation="vertical" flexItem sx={{ display: { xs: 'none', sm: 'block' } }} />
          <YearColumn label={`Last tax year (${lastYear.label})`} year={lastYear.label} propertyId={propertyId} />
        </Stack>

        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
          Tracked but restricted to basic-rate (20%) relief under S.24 — not deducted as
          an ordinary expense. Aggregated across all mortgages tagged to this property.
        </Typography>
      </CardContent>
    </Card>
  );
}

function YearColumn({
  label,
  year,
  propertyId,
}: {
  label: string;
  year: string;
  propertyId: number;
}) {
  const recorded = useSWR<ReportResponse>(
    `/api/properties/${propertyId}/tax-year-report?year=${year}&summary=true`,
    fetcher,
  );
  const computed = useSWR<SummaryResponse>(
    `/api/properties/${propertyId}/mortgage-interest-summary?year=${year}`,
    fetcher,
  );

  return (
    <Box flex={1}>
      <Typography variant="caption" color="text.secondary">{label}</Typography>

      <Box sx={{ mt: 0.5 }}>
        <Typography variant="caption" color="text.secondary">Recorded (journals)</Typography>
        {recorded.isLoading ? (
          <Skeleton width={100} height={28} />
        ) : recorded.error ? (
          <Typography variant="h6" color="text.disabled" title="Could not load">—</Typography>
        ) : (
          <Typography variant="h6">{formatCurrency(recorded.data?.totals?.mortgageInterest ?? '0')}</Typography>
        )}
      </Box>

      <ComputedBlock state={computed} />
    </Box>
  );
}

function ComputedBlock({
  state,
}: {
  state: SWRResponse<SummaryResponse, Error>;
}) {
  if (state.isLoading) {
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">Computed (rate history)</Typography>
        <Skeleton width={100} height={28} />
      </Box>
    );
  }
  if (state.error || !state.data) {
    const msg = state.error instanceof Error ? state.error.message : 'Could not load';
    return (
      <Box sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">Computed (rate history)</Typography>
        <Typography variant="body2" color="text.disabled" title={msg}>—</Typography>
      </Box>
    );
  }

  const { totalInterest, basicRateCredit, totalDays, uncoveredDays } = state.data;
  const allUncovered = totalDays > 0 && uncoveredDays === totalDays;
  const partialCoverage = uncoveredDays > 0 && !allUncovered;
  const noMortgages = state.data.perMortgage.length === 0;

  return (
    <Box sx={{ mt: 1 }}>
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Typography variant="caption" color="text.secondary">Computed (rate history)</Typography>
        {partialCoverage && (
          <Chip
            size="small"
            label={`${uncoveredDays} days uncovered`}
            variant="outlined"
            color="warning"
            sx={{ height: 16, fontSize: '0.625rem' }}
          />
        )}
      </Stack>
      {noMortgages ? (
        <Typography variant="body2" color="text.disabled">—</Typography>
      ) : allUncovered ? (
        <Alert severity="info" sx={{ mt: 0.5, py: 0 }}>
          Add a rate effective on or before the start of this tax year to compute interest.
        </Alert>
      ) : (
        <>
          <Typography variant="h6" color={partialCoverage ? 'text.secondary' : 'text.primary'}>
            {formatCurrency(totalInterest)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            S.24 credit (20%): <strong>{formatCurrency(basicRateCredit)}</strong>
          </Typography>
        </>
      )}
    </Box>
  );
}
