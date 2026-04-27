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
import { currentTaxYear } from '@/lib/tax/ukTaxYear';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface IncomeLine {
  source: 'tenancy_schedule' | 'journal';
  bookEntryId?: number;
  journalId?: number;
  tenancyId?: number;
  tenantName?: string;
  date: string;
  periodStart?: string;
  periodEnd?: string;
  description?: string;
  account?: string;
  amount: string;
}

interface ExpenseLine {
  bookEntryId: number;
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
  otherIncome: IncomeLine[];
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

  // The server applies the owner allocation per line and reports totals as
  // the sum of the allocated lines, so the UI can display both directly
  // without doing any client-side rounding (which would otherwise drift).
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

      <YearSelector propertyId={id} currentYear={report.taxYear.label} />

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
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
              <Typography variant="caption" color="text.secondary">
                Showing {report.allocationPct}% share. Per-line amounts are pre-allocated server-side so the table sums match the totals exactly.
              </Typography>
              <Button
                component={Link}
                size="small"
                href={`/owners/${ownerId}/tax-year/${report.taxYear.label}`}
              >
                {owners.find(o => o.owner_id === ownerId)?.owner_name ?? 'Owner'}&apos;s combined report →
              </Button>
            </Stack>
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
                  i.date,
                  i.periodStart ?? '',
                  i.periodEnd ?? '',
                  i.tenantName ?? '',
                  i.amount,
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
                  <TableRow key={`${i.tenancyId ?? 'x'}-${idx}`}>
                    <TableCell>{i.date}</TableCell>
                    <TableCell>{i.periodStart} → {i.periodEnd}</TableCell>
                    <TableCell>{i.tenantName}</TableCell>
                    <TableCell align="right">{formatCurrency(i.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {report.otherIncome.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
              <Box>
                <Typography variant="h6">Other income (manual journal entries)</Typography>
                <Typography variant="caption" color="text.secondary">
                  Non-rent income tagged to this property — laundry, deposit retention, one-off fees etc.
                </Typography>
              </Box>
              <Button
                size="small"
                startIcon={<DownloadIcon />}
                onClick={() => downloadCsv(
                  `other-income-${fileBase}${ownerSuffix}.csv`,
                  ['Date', 'Description', 'Account', 'Amount'],
                  report.otherIncome.map(r => [r.date, r.description ?? '', r.account ?? '', r.amount]),
                )}
              >
                CSV
              </Button>
            </Stack>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Date</TableCell>
                  <TableCell>Description</TableCell>
                  <TableCell>Account</TableCell>
                  <TableCell align="right">Amount</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {report.otherIncome.map(r => (
                  <TableRow key={r.bookEntryId}>
                    <TableCell>{r.date}</TableCell>
                    <TableCell>{r.description}</TableCell>
                    <TableCell>{r.account}</TableCell>
                    <TableCell align="right">{formatCurrency(r.amount)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <ExpenseSection
        title="Itemised deductible expenses"
        rows={report.expenses}
        emptyHint={
          'No expenses recorded for this property in this tax year. '
          + 'Tag historical transactions via the AI chat ("tag last quarter\'s repairs to this property") '
          + 'or use Auto-link existing on the property page after running a categorisation pass. '
          + 'Tax-year reports filter by transaction date, so transactions before 6 April of the displayed year sit on the previous tax year - try the year selector above.'
        }
        onDownload={() => downloadCsv(
          `expenses-${fileBase}${ownerSuffix}.csv`,
          ['Date', 'Description', 'Category', 'Account', 'Reference', 'Amount'],
          report.expenses.map(r => [
            r.date, r.description, r.category ?? '', r.account, r.reference ?? '',
            r.amount,
          ]),
        )}
      />

      <ExpenseSection
        title="Mortgage interest (separate - restricted to basic-rate relief under S.24)"
        rows={report.mortgageInterest}
        emptyHint={
          'No mortgage-interest journals for this property in this tax year. '
          + 'The Mortgage Interest card on the property page already shows the rate-history-computed figure that HMRC needs for S.24 relief; '
          + 'this section only fills in if you have explicit journals against the system "Mortgage Interest" account. '
          + 'A "Generate interest journals" flow is queued.'
        }
        onDownload={() => downloadCsv(
          `mortgage-interest-${fileBase}${ownerSuffix}.csv`,
          ['Date', 'Description', 'Category', 'Account', 'Reference', 'Amount'],
          report.mortgageInterest.map(r => [
            r.date, r.description, r.category ?? '', r.account, r.reference ?? '',
            r.amount,
          ]),
        )}
      />
    </Box>
  );
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
  onDownload,
}: {
  title: string;
  rows: ExpenseLine[];
  emptyHint: string;
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
                <TableRow key={r.bookEntryId}>
                  <TableCell>{r.date}</TableCell>
                  <TableCell>{r.description}</TableCell>
                  <TableCell>{r.category ?? '—'}</TableCell>
                  <TableCell>{r.account}</TableCell>
                  <TableCell align="right">{formatCurrency(r.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Tax-year navigator. The route param is the year label (e.g. "2025-26");
 * each pill links to the same property's report at a different year.
 *
 * Range: from the property-tracking origin year (we reach back 5 years
 * because BTL accounts often start a couple of years before the user
 * tracks them) up to next year (so users can pre-flight a return
 * before April rolls over). Anchor links rather than client-side
 * routing because each year is a fresh SWR fetch and Next file-based
 * routing already gives us proper history entries.
 */
function YearSelector({ propertyId, currentYear }: { propertyId: string; currentYear: string }) {
  const thisYear = currentTaxYear().label;
  // taxYearRange's label format is "YYYY-YY" (e.g. "2025-26"). Walk back
  // 5 from `thisYear`, forward 1.
  const startYear = parseInt(thisYear.split('-')[0], 10);
  const years: string[] = [];
  for (let offset = -5; offset <= 1; offset++) {
    const y = startYear + offset;
    const next = String((y + 1) % 100).padStart(2, '0');
    years.push(`${y}-${next}`);
  }
  return (
    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 3 }} flexWrap="wrap" useFlexGap>
      <Typography variant="body2" color="text.secondary">Tax year</Typography>
      <ToggleButtonGroup size="small" exclusive value={currentYear}>
        {years.map(y => (
          <ToggleButton
            key={y}
            value={y}
            component={Link}
            href={`/properties/${propertyId}/reports/${y}`}
            selected={y === currentYear}
          >
            {y}
            {y === thisYear ? ' (current)' : ''}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
