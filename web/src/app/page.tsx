'use client';

import { Box, Grid, Typography, Skeleton } from '@mui/material';
import { format } from 'date-fns';
import useSWR from 'swr';
import NetWorthCard from '@/components/dashboard/NetWorthCard';
import MonthlySummaryCard from '@/components/dashboard/MonthlySummaryCard';
import SavingsRateCard from '@/components/dashboard/SavingsRateCard';
import TopCategoriesCard from '@/components/dashboard/TopCategoriesCard';
import RecentTransactionsTable from '@/components/dashboard/RecentTransactionsTable';
import AiInsightsCard from '@/components/dashboard/AiInsightsCard';
import BudgetOverviewCard from '@/components/dashboard/BudgetOverviewCard';
import SavingsGoalsCard from '@/components/dashboard/SavingsGoalsCard';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function DashboardPage() {
  const { data: balances, isLoading: loadingBalances } = useSWR('/api/accounts?balances=true', fetcher);
  const { data: spending, isLoading: loadingSpending } = useSWR('/api/journal/monthly-spending', fetcher);
  const { data: journalData, isLoading: loadingJournal } = useSWR('/api/journal?limit=10', fetcher);

  const recentEntries = journalData?.entries ?? [];

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 18) return 'Good afternoon';
    return 'Good evening';
  })();

  return (
    <Box>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4">{greeting}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          {format(new Date(), 'EEEE, d MMMM yyyy')}
        </Typography>
      </Box>

      <Grid container spacing={2.5}>
        {/* Metric cards row */}
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {loadingBalances ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : (
            <NetWorthCard balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : (
            <MonthlySummaryCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : (
            <SavingsRateCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={180} sx={{ borderRadius: 5 }} /> : (
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
          {loadingJournal ? <Skeleton variant="rounded" height={400} sx={{ borderRadius: 5 }} /> : (
            <RecentTransactionsTable entries={recentEntries} />
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
