'use client';

import { Box, Grid, Typography, Skeleton } from '@mui/material';
import useSWR from 'swr';
import NetWorthCard from '@/components/dashboard/NetWorthCard';
import MonthlySummaryCard from '@/components/dashboard/MonthlySummaryCard';
import SavingsRateCard from '@/components/dashboard/SavingsRateCard';
import TopCategoriesCard from '@/components/dashboard/TopCategoriesCard';
import RecentTransactionsTable from '@/components/dashboard/RecentTransactionsTable';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export default function DashboardPage() {
  const { data: balances, isLoading: loadingBalances } = useSWR('/api/accounts?balances=true', fetcher);
  const { data: spending, isLoading: loadingSpending } = useSWR('/api/journal/monthly-spending', fetcher);
  const { data: journalData, isLoading: loadingJournal } = useSWR('/api/journal?limit=10', fetcher);

  const recentEntries = journalData?.entries ?? [];

  return (
    <Box>
      <Typography variant="h4" sx={{ mb: 3 }}>Dashboard</Typography>
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {loadingBalances ? <Skeleton variant="rounded" height={140} /> : (
            <NetWorthCard balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={140} /> : (
            <MonthlySummaryCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={140} /> : (
            <SavingsRateCard spending={spending ?? []} balances={balances ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
          {loadingSpending ? <Skeleton variant="rounded" height={140} /> : (
            <TopCategoriesCard spending={spending ?? []} />
          )}
        </Grid>
        <Grid size={{ xs: 12 }}>
          {loadingJournal ? <Skeleton variant="rounded" height={400} /> : (
            <RecentTransactionsTable entries={recentEntries} />
          )}
        </Grid>
      </Grid>
    </Box>
  );
}
