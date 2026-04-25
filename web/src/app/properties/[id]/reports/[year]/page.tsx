'use client';

import { use, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Card,
  CardContent,
  Skeleton,
  Stack,
  Divider,
  Button,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableHead,
  TableRow,
  TableCell,
  TableBody,
  Alert,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import DownloadIcon from '@mui/icons-material/Download';
import Link from 'next/link';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface IncomeLine {
  tenancyId: number;
  tenantName: string;
  dueDate: string;
  periodStart: string;
  periodEnd: string;
  amount: string;
}

interface ExpenseLine {
  journalId: number;
  date: string;
  description: string;
  reference: string | null;
  category: string | null;
  account: string;
  amount: string;
}

interface ReportTotals {
  grossIncome: string;
  totalExpenses: string;
  mortgageInterest: string;
  netBeforeMortgageRelief: string;
}

interface ReportResponse {
  property: { id: number; name: string; address: string | null };
  taxYear: { label: string; startDate: string; endDate: string };
  allocationPct: string;
  ownerId: number | null;
  income: IncomeLine[];
  incomeSource: 'tenancy_schedule';
  expenses: ExpenseLine[];
  mortgageInterest: ExpenseLine[];
  totals: ReportTotals;
  totalsForOwner: ReportTotals | null;
}

interface OwnerRow { owner_id: number; owner_name: string }

function downloadCsv(filename: string, header: string[], rows: string[][]) {
  const escape = (s: string) => `"${(s ?? '').replace(/"/g, '""')}"`;
  const body = rows.map(r => r.map(escape).join(','));
  const csv = [header.join(','), ...body].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function TaxYearReportPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year } = use(params);
  const [ownerId, setOwnerId] = useState<number | null>(null);

  const reportUrl = `/api/properties/${id}/tax-year-report?year=${year}${ownerId ? `&ownerId=${ownerId}` : ''}`;
  const { data: report, isLoading, error } = useSWR<ReportResponse>(reportUrl, fetcher);
  const { data: property } = useSWR<{ ownership: OwnerRow[] }>(`/api/properties/${id}`, fetcher);

  const owners = useMemo(() => property?.ownership ?? [], [property]);
  const factor = useMemo(() => {
    if (!ownerId || !report) return 1;
    return Number(report.allocationPct) / 100;
  }, [ownerId, report]);
  const totals = (ownerId && report?.totalsForOwner) ? report.totalsForOwner : report?.totals;

  if (isLoading) return <Skeleton variant="rounded" height={400} />;
  if (error || !report) {
    return <Alert severity="error">Failed to load report</Alert>;
  }
  if ('error' in report) {
    return <Alert severity="error">{(report as unknown as { error: string }).error}</Alert>;
  }

  const fileBase = `${report.property.name.replace(/\W+/g, '-')}-${report.taxYear.label}`;
  const ownerSuffix = ownerId ? `-share-${report.allocationPct}pct` : '';

  return (
    <Box>
      <Button component={Link} href={`/properties/${id}`} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to Property
      </Button>

      <Typography variant="h4">{report.property.name}</Typography>
      <Typography variant="subtitle1" color="text.secondary" sx={{ mb: 2 }}>
        UK tax year {report.taxYear.label} ({report.taxYear.startDate} to {report.taxYear.endDate})
      </Typography>

      {owners.length > 0 && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }}>
          <Typography variant="body2" color="text.secondary">View as</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={ownerId ?? 'full'}
            onChange={(_, v) => setOwnerId(v === 'full' || v === null ? null : Number(v))}
          >
            <ToggleButton value="full">Full property (100%)</ToggleButton>
            {owners.map(o => (
              <ToggleButton key={o.owner_id} value={o.owner_id}>
                {o.owner_name}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Stack>
      )}

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>Summary</Typography>
          {totals && (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4} divider={<Divider flexItem orientation="vertical" />}>
              <SummaryItem label="Gross income" value={totals.grossIncome} />
              <SummaryItem label="Deductible expenses" value={totals.totalExpenses} />
              <SummaryItem label="Mortgage interest (S.24, basic-rate relief)" value={totals.mortgageInterest} />
              <SummaryItem label="Net before mortgage relief" value={totals.netBeforeMortgageRelief} bold />
            </Stack>
          )}
          {ownerId && (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
              Showing {report.allocationPct}% share for selected owner.
            </Typography>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Box>
              <Typography variant="h6">Gross income (computed from tenancy contracts)</Typography>
              <Typography variant="caption" color="text.secondary">
                Source: tenancy contracts on this property. To change figures, edit the tenancy.
              </Typography>
            </Box>
            <Button
              size="small"
              startIcon={<DownloadIcon />}
              disabled={report.income.length === 0}
              onClick={() => downloadCsv(
                `income-${fileBase}${ownerSuffix}.csv`,
                ['Due date', 'Period start', 'Period end', 'Tenant', 'Amount'],
                report.income.map(i => [
                  i.dueDate,
                  i.periodStart,
                  i.periodEnd,
                  i.tenantName,
                  applyShare(i.amount, factor),
                ]),
              )}
            >
              CSV
            </Button>
          </Stack>
          {report.income.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tenancy active in this tax year. Add a tenancy with start/end dates and rent on the property page.
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Due date</TableCell>
                  <TableCell>Period</TableCell>
                  <TableCell>Tenant</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.income.map((i, idx) => (
                  <TableRow key={`${i.tenancyId}-${idx}`}>
                    <TableCell>{i.dueDate}</TableCell>
                    <TableCell>{i.periodStart} → {i.periodEnd}</TableCell>
                    <TableCell>{i.tenantName}</TableCell>
                    <TableCell align="right">{formatCurrency(applyShare(i.amount, factor))}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ExpenseSection
        title="Itemised deductible expenses"
        rows={report.expenses}
        emptyHint="No expenses recorded for this property in this tax year. (Expense capture UI lands in Sprint 2.)"
        factor={factor}
        onDownload={() => downloadCsv(
          `expenses-${fileBase}${ownerSuffix}.csv`,
          ['Date', 'Description', 'Category', 'Account', 'Reference', 'Amount'],
          report.expenses.map(r => [
            r.date, r.description, r.category ?? '', r.account, r.reference ?? '',
            applyShare(r.amount, factor),
          ]),
        )}
      />

      <ExpenseSection
        title="Mortgage interest (separate — restricted to basic-rate relief under S.24)"
        rows={report.mortgageInterest}
        emptyHint="No mortgage interest recorded for this property in this tax year. (Mortgage payments need to be tagged with the property — Sprint 2.)"
        factor={factor}
        onDownload={() => downloadCsv(
          `mortgage-interest-${fileBase}${ownerSuffix}.csv`,
          ['Date', 'Description', 'Category', 'Account', 'Reference', 'Amount'],
          report.mortgageInterest.map(r => [
            r.date, r.description, r.category ?? '', r.account, r.reference ?? '',
            applyShare(r.amount, factor),
          ]),
        )}
      />
    </Box>
  );
}

function applyShare(amount: string, factor: number): string {
  if (factor === 1) return amount;
  return (Number(amount) * factor).toFixed(2);
}

function SummaryItem({ label, value, bold = false }: { label: string; value: string; bold?: boolean }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary">{label}</Typography>
      <Typography variant={bold ? 'h6' : 'body1'} fontWeight={bold ? 700 : 500}>
        {formatCurrency(value)}
      </Typography>
    </Box>
  );
}

function ExpenseSection({
  title,
  rows,
  emptyHint,
  factor,
  onDownload,
}: {
  title: string;
  rows: ExpenseLine[];
  emptyHint: string;
  factor: number;
  onDownload: () => void;
}) {
  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6">{title}</Typography>
          <Button size="small" startIcon={<DownloadIcon />} onClick={onDownload} disabled={rows.length === 0}>
            CSV
          </Button>
        </Stack>
        {rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">{emptyHint}</Typography>
        ) : (
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Description</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Account</TableCell>
                <TableCell align="right">Amount</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.journalId}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.category ?? '—'}</TableCell>
                  <TableCell>{r.account}</TableCell>
                  <TableCell align="right">{formatCurrency(applyShare(r.amount, factor))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
