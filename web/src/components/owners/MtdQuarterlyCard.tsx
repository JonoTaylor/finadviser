'use client';

import useSWR from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Box,
  Skeleton,
  Alert,
  Chip,
  Divider,
  Button,
} from '@mui/material';
import DownloadIcon from '@mui/icons-material/Download';
import { formatCurrency } from '@/lib/utils/formatting';
import { londonTodayIso } from '@/lib/dates/today';

interface QuarterPropertyShare {
  propertyId: number;
  propertyName: string;
  allocationPct: string;
  grossIncome: string;
}

interface OwnerQuarter {
  index: 1 | 2 | 3 | 4;
  label: string;
  startDate: string;
  endDate: string;
  submissionDeadline: string;
  grossIncome: string;
  perProperty: QuarterPropertyShare[];
}

interface OwnerQuarterlyReport {
  owner: { id: number; name: string };
  taxYear: { label: string; startDate: string; endDate: string };
  quarters: OwnerQuarter[];
}

const fetcher = async (url: string): Promise<OwnerQuarterlyReport> => {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

type QuarterStatus = 'past' | 'current' | 'future';

function quarterStatus(q: OwnerQuarter, today: string): QuarterStatus {
  if (today > q.endDate) return 'past';
  if (today >= q.startDate) return 'current';
  return 'future';
}

function StatusChip({ status, deadline, today }: { status: QuarterStatus; deadline: string; today: string }) {
  if (status === 'current') return <Chip size="small" color="primary" label="Current" />;
  if (status === 'future') return <Chip size="small" label="Future" />;
  // Past: highlight whether the deadline has also passed
  const deadlinePassed = today > deadline;
  return (
    <Chip
      size="small"
      color={deadlinePassed ? 'warning' : 'default'}
      label={deadlinePassed ? 'Past — deadline passed' : 'Past'}
    />
  );
}

export default function MtdQuarterlyCard({ ownerId, year }: { ownerId: number | string; year: string }) {
  const today = londonTodayIso();
  const { data, error, isLoading } = useSWR<OwnerQuarterlyReport>(
    `/api/owners/${ownerId}/mtd/quarters?year=${year}`,
    fetcher,
  );

  if (isLoading) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>MTD-IT quarterly</Typography>
          <Skeleton height={120} />
        </CardContent>
      </Card>
    );
  }
  if (error || !data) {
    return (
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>MTD-IT quarterly</Typography>
          <Alert severity="error">{error?.message ?? 'Failed to load quarterly report'}</Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" alignItems={{ md: 'baseline' }} spacing={1} sx={{ mb: 1 }}>
          <Typography variant="h6">MTD-IT quarterly (gross income only)</Typography>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadIcon />}
              component="a"
              href={`/api/owners/${ownerId}/mtd/quarters/export?year=${year}`}
            >
              Quarterly CSV
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<DownloadIcon />}
              component="a"
              href={`/api/owners/${ownerId}/mtd/end-of-year/export?year=${year}`}
            >
              End-of-year CSV
            </Button>
            <Typography variant="caption" color="text.secondary">
              Tax year {data.taxYear.label}
            </Typography>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Per HMRC, quarterly updates declare your share of gross rent only — expenses go in the
          end-of-year return. Figures here are computed from tenancy contracts. Use the bridging
          CSVs to import into MyTaxDigital, FreeAgent Landlord, or paste straight into HMRC.
        </Typography>

        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          divider={<Divider flexItem orientation="vertical" />}
        >
          {data.quarters.map(q => {
            const status = quarterStatus(q, today);
            return (
              <Box key={q.index} flex={1}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                  <Typography variant="subtitle2">Q{q.index}</Typography>
                  <StatusChip status={status} deadline={q.submissionDeadline} today={today} />
                </Stack>
                <Typography variant="caption" color="text.secondary" display="block">
                  {q.startDate} → {q.endDate}
                </Typography>
                <Typography variant="caption" color="text.secondary" display="block">
                  Submit by {q.submissionDeadline}
                </Typography>
                <Typography variant="h6" sx={{ mt: 0.5 }}>
                  {formatCurrency(q.grossIncome)}
                </Typography>
              </Box>
            );
          })}
        </Stack>
      </CardContent>
    </Card>
  );
}
