'use client';

import { use } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Divider,
  Button,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import DownloadIcon from '@mui/icons-material/Download';
import Link from 'next/link';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';
import MtdQuarterlyCard from '@/components/owners/MtdQuarterlyCard';

interface Totals {
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
  netBeforeMortgageRelief: string;
}

interface PropertySummary {
  propertyId: number;
  propertyName: string;
  allocationPct: string;
  totals: Totals;
}

interface OwnerReport {
  owner: { id: number; name: string };
  taxYear: { label: string; startDate: string; endDate: string };
  properties: PropertySummary[];
  combined: Totals;
}

const fetcher = async (url: string): Promise<OwnerReport> => {
  const res = await fetch(url);
  if (!res.ok) {
    // Surface the API's { error } body so the user sees an actionable
    // message ("Owner 99 not found") rather than a generic failure.
    const body = await res.json().catch(() => ({} as { error?: string }));
    throw new Error(body.error || `HTTP ${res.status}`);
  }
  return res.json();
};

export default function OwnerTaxYearReportPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = use(params);
  const { data: report, isLoading, error } = useSWR<OwnerReport>(
    `/api/owners/${id}/tax-year-report?year=${year}`,
    fetcher,
  );

  if (isLoading) return <Skeleton variant="rounded" height={400} />;
  if (error || !report) {
    return <Alert severity="error">{error?.message ?? 'Failed to load report'}</Alert>;
  }

  return (
    <Box>
      <Button component={Link} href="/" startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to dashboard
      </Button>

      <Typography variant="h4">{report.owner.name}</Typography>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 3 }}>
        <Typography variant="subtitle1" color="text.secondary">
          UK tax year {report.taxYear.label} ({report.taxYear.startDate} to {report.taxYear.endDate})
          — owner share across all properties
        </Typography>
        <Button
          variant="contained"
          size="small"
          startIcon={<DownloadIcon />}
          component="a"
          href={`/api/owners/${id}/tax-year-export?year=${report.taxYear.label}`}
          disabled={report.properties.length === 0}
        >
          Download accountant pack
        </Button>
      </Stack>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Combined totals (this owner&apos;s share)</Typography>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={4}
            divider={<Divider flexItem orientation="vertical" />}
          >
            <Item label="Gross income" value={report.combined.grossIncome} />
            <Item label="Deductible expenses" value={report.combined.totalExpenses} />
            <Item label="Mortgage interest (S.24)" value={report.combined.mortgageInterest} />
            <Item label="Net before mortgage relief" value={report.combined.netBeforeMortgageRelief} bold />
          </Stack>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
            Combined totals = sum of each property&apos;s server-allocated lines, so they reconcile
            exactly to what you see on each property&apos;s individual tax-year report.
          </Typography>
        </CardContent>
      </Card>

      <MtdQuarterlyCard ownerId={id} year={report.taxYear.label} />

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Per-property breakdown</Typography>
          {report.properties.length === 0 ? (
            <Typography color="text.secondary">
              {report.owner.name} doesn&apos;t own any properties on record.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Property</TableCell>
                  <TableCell align="right">Share</TableCell>
                  <TableCell align="right">Gross income</TableCell>
                  <TableCell align="right">Deductible expenses</TableCell>
                  <TableCell align="right">Mortgage interest</TableCell>
                  <TableCell align="right">Net before relief</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {report.properties.map(p => (
                  <TableRow key={p.propertyId}>
                    <TableCell>{p.propertyName}</TableCell>
                    <TableCell align="right">{parseFloat(p.allocationPct)}%</TableCell>
                    <TableCell align="right">{formatCurrency(p.totals.grossIncome)}</TableCell>
                    <TableCell align="right">{formatCurrency(p.totals.totalExpenses)}</TableCell>
                    <TableCell align="right">{formatCurrency(p.totals.mortgageInterest)}</TableCell>
                    <TableCell align="right">{formatCurrency(p.totals.netBeforeMortgageRelief)}</TableCell>
                    <TableCell align="right">
                      <Button
                        size="small"
                        variant="text"
                        endIcon={<OpenInNewIcon fontSize="small" />}
                        component={Link}
                        href={`/properties/${p.propertyId}/reports/${report.taxYear.label}?ownerId=${report.owner.id}`}
                      >
                        Detail
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </Box>
  );
}

function Item({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant={bold ? 'h6' : 'body1'} fontWeight={bold ? 700 : 500}>
        {formatCurrency(value)}
      </Typography>
    </Box>
  );
}
