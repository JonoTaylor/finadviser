'use client';

import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Grid, Typography, Skeleton } from '@mui/material';
import FileUploadOutlinedIcon from '@mui/icons-material/FileUploadOutlined';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import useSWR from 'swr';
import Link from 'next/link';
import YourShareCard from '@/components/dashboard/YourShareCard';
import MonthlySummaryCard from '@/components/dashboard/MonthlySummaryCard';
import MonthlySpendingCard from '@/components/dashboard/MonthlySpendingCard';
import SavingsRateCard from '@/components/dashboard/SavingsRateCard';
import TopCategoriesCard from '@/components/dashboard/TopCategoriesCard';
import RecentTransactionsTable from '@/components/dashboard/RecentTransactionsTable';
import AiInsightsCard from '@/components/dashboard/AiInsightsCard';
import BudgetOverviewCard from '@/components/dashboard/BudgetOverviewCard';
import SavingsGoalsCard from '@/components/dashboard/SavingsGoalsCard';
import PlanningSnapshotCard from '@/components/dashboard/PlanningSnapshotCard';
import DashboardCardHeader from '@/components/dashboard/DashboardCardHeader';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import DataProcessingCard from '@/components/data/DataProcessingCard';

export default function DashboardPage() {
  const [now] = useState(() => new Date());
  const { data: spending, error: spendingError, isLoading: loadingSpending } = useSWR<Parameters<typeof MonthlySummaryCard>[0]['spending']>('/api/journal/monthly-spending', fetchJson);
  const { data: journalData, error: journalError, isLoading: loadingJournal } = useSWR<{ entries: Parameters<typeof RecentTransactionsTable>[0]['entries'] }>('/api/journal?limit=10', fetchJson);
  const dateLabel = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now);

  return <Box sx={{ minWidth: 0 }}>
    <PageHeader title="Financial overview" description={dateLabel} actions={<>
        <Button component={Link} href="/import" variant="outlined" startIcon={<FileUploadOutlinedIcon sx={{ fontSize: 18 }} />}>Import transactions</Button>
        <Button component={Link} href="/chat" variant="contained" startIcon={<ChatBubbleOutlineRoundedIcon sx={{ fontSize: 18 }} />}>Ask adviser</Button>
    </>} />

    <Grid container spacing={2.5}>
      {(spendingError || journalError) && <Grid size={{ xs: 12 }}><Alert severity="warning">Some account data could not be loaded. Figures will appear when your accounts are available; missing data is not a zero balance.</Alert></Grid>}
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}><YourShareCard /></Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
        {loadingSpending ? <MetricLoading /> : spendingError ? <MetricUnavailable title="Monthly cash flow" detail="Monthly cash flow is unavailable." /> : <MonthlySummaryCard spending={spending ?? []} balances={[]} />}
      </Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
        {loadingSpending ? <MetricLoading /> : spendingError ? <MetricUnavailable title="Savings rate" detail="The savings rate needs account activity." /> : <SavingsRateCard spending={spending ?? []} balances={[]} />}
      </Grid>
      <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
        {loadingSpending ? <MetricLoading /> : spendingError ? <MetricUnavailable title="Monthly spending" detail="Monthly spending is unavailable." /> : <MonthlySpendingCard spending={spending ?? []} />}
      </Grid>
      <Grid size={{ xs: 12 }}><DataProcessingCard /></Grid>
      <Grid size={{ xs: 12 }}><PlanningSnapshotCard /></Grid>
      <Grid size={{ xs: 12, md: 7 }}>
        {loadingSpending ? <Skeleton variant="rounded" height={340} sx={{ borderRadius: '8px' }} /> : spendingError ? <MetricUnavailable title="Category activity" detail="Spending categories are unavailable." /> : <TopCategoriesCard spending={spending ?? []} />}
      </Grid>
      <Grid size={{ xs: 12, md: 5 }}><BudgetOverviewCard /></Grid>
      <Grid size={{ xs: 12, lg: 8 }}>
        {loadingJournal ? <Skeleton variant="rounded" height={350} sx={{ borderRadius: '8px' }} /> : journalError ? <MetricUnavailable title="Recent activity" detail="Recent transactions could not be loaded." /> : <RecentTransactionsTable entries={journalData?.entries ?? []} />}
      </Grid>
      <Grid size={{ xs: 12, lg: 4 }}><SavingsGoalsCard /></Grid>
      <Grid size={{ xs: 12 }}><AiInsightsCard /></Grid>
    </Grid>
  </Box>;
}

function MetricLoading() {
  return <Card sx={{ height: '100%' }}><CardContent><Skeleton width="60%" height={24} /><Skeleton width="85%" height={48} sx={{ mt: 2 }} /><Skeleton width="100%" height={90} sx={{ mt: 2 }} /></CardContent></Card>;
}

function MetricUnavailable({ title, detail }: { title: string; detail: string }) {
  return <Card sx={{ height: '100%' }}><CardContent>
    <DashboardCardHeader title={title} />
    <Typography sx={{ fontSize: '2rem', fontWeight: 600, mb: 1.5 }}>—</Typography>
    <Typography variant="body2" color="text.secondary">{detail}</Typography>
  </CardContent></Card>;
}
