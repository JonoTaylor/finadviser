'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Box, Button, Card, CardContent, Chip, Grid, Skeleton, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import type { FinancialPlan } from '@/lib/planning/types';
import { softTokens } from '@/theme/theme';

export default function PlanningSnapshotCard() {
  const { data, error, isLoading } = useSWR<{ plan: FinancialPlan }>('/api/planning/overview', fetchJson, { shouldRetryOnError: false });
  return <Card sx={{ bgcolor: softTokens.cream }}><CardContent>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} alignItems={{ sm: 'center' }}>
      <Box><Typography variant="overline" sx={{ color: softTokens.mint.ink }}>THE NEXT STEP FOR YOUR MONEY</Typography><Typography variant="h5">Your finances, working together</Typography><Typography variant="body2" sx={{ mt: 1 }}>A clear plan for spending less, building wealth and preparing for the future.</Typography></Box>
      <Button component={Link} href="/plan" variant="contained" endIcon={<ArrowForwardRoundedIcon />} sx={{ flexShrink: 0 }}>Open my financial plan</Button>
    </Stack>
    {isLoading && <Skeleton sx={{ mt: 2 }} height={80} />}
    {error && <Typography variant="body2" sx={{ mt: 2 }}>Connect or import your accounts to see priorities based on your figures. You can explore the planning tools now.</Typography>}
    {data && <Grid container spacing={2} sx={{ mt: 1 }}>{data.plan.actions.slice(0, 3).map(action => <Grid key={action.id} size={{ xs: 12, md: 4 }}><Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 3, height: '100%' }}><Chip size="small" label={action.topic} sx={{ mb: 1 }} /><Typography variant="body2" fontWeight={600}>{action.title}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{action.evidence}</Typography></Box></Grid>)}</Grid>}
  </CardContent></Card>;
}
