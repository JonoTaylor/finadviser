'use client';

import { Alert, Box, Button, Grid, Stack, Typography, Skeleton } from '@mui/material';
import { format } from 'date-fns';
import useSWR from 'swr';
import YourShareCard from '@/components/dashboard/YourShareCard';
import MonthlySummaryCard from '@/components/dashboard/MonthlySummaryCard';
import SavingsRateCard from '@/components/dashboard/SavingsRateCard';
import TopCategoriesCard from '@/components/dashboard/TopCategoriesCard';
import RecentTransactionsTable from '@/components/dashboard/RecentTransactionsTable';
import AiInsightsCard from '@/components/dashboard/AiInsightsCard';
import BudgetOverviewCard from '@/components/dashboard/BudgetOverviewCard';
import SavingsGoalsCard from '@/components/dashboard/SavingsGoalsCard';
import PlanningSnapshotCard from '@/components/dashboard/PlanningSnapshotCard';
import { fetchJson } from '@/lib/http/client';
import Link from 'next/link';

const fetcher = fetchJson;

export default function DashboardPage() {
  const { data: balances, error: balancesError, isLoading: loadingBalances } = useSWR<Parameters<typeof MonthlySummaryCard>[0]['balances']>('/api/accounts?balances=true', fetcher);
  const { data: spending, error: spendingError, isLoading: loadingSpending } = useSWR<Parameters<typeof MonthlySummaryCard>[0]['spending']>('/api/journal/monthly-spending', fetcher);
  const { data: journalData, error: journalError, isLoading: loadingJournal } = useSWR<{ entries: Parameters<typeof RecentTransactionsTable>[0]['entries'] }>('/api/journal?limit=10', fetcher);

  const recentEntries = journalData?.entries ?? [];

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} sx={{ mb: 4 }}>
        <Box>
        <Typography variant="h4">{greeting}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {format(new Date(), 'EEEE, d MMMM yyyy')}
        </Typography>
        </Box>
        <Stack direction="row" gap={1} flexWrap="wrap" alignItems="center"><Button component={Link} href="/spending" variant="outlined">Review spending</Button><Button component={Link} href="/pensions" variant="outlined">Plan retirement</Button></Stack>
      </Stack>

      <Grid container spacing={2.5}>
        <Grid size={{ xs: 12 }}><PlanningSnapshotCard /></Grid>
        {(balancesError || spendingError || journalError) && <Grid size={{ xs: 12 }}><Alert severity="warning">Some account data could not be loaded. Figures will appear when your accounts are available; missing data is not a zero balance.</Alert></Grid>}
        {/* Metric cards row */}
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <YourShareCard />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {(loadingSpending || loadingBalances) ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : balancesError || spendingError ? <Alert severity="info">Monthly cash flow is unavailable.</Alert> : (
            <MonthlySummaryCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {(loadingSpending || loadingBalances) ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : balancesError || spendingError ? <Alert severity="info">The savings rate needs account activity.</Alert> : (
            <SavingsRateCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : spendingError ? <Alert severity="info">Spending categories are unavailable.</Alert> : (
            <TopCategoriesCard spending={spending ?? []} />
          )}
        </Grid>

        {/* Budget & Savings row */}
        <Grid size={{ xs: 12, md: 6 }}>
          <BudgetOverviewCard />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <SavingsGoalsCard />
        </Grid>

        {/* AI Insights */}
        <Grid size={{ xs: 12 }}>
          <AiInsightsCard />
        </Grid>

        {/* Recent transactions */}
        <Grid size={{ xs: 12 }}>
          {loadingJournal ? <Skeleton variant="rounded" height={400} sx={{ borderRadius: 5 }} /> : journalError ? <Alert severity="info">Recent transactions could not be loaded.</Alert> : (
            <RecentTransactionsTable entries={recentEntries} />
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
