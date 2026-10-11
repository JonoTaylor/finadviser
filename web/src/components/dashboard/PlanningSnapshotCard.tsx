'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Skeleton, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import type { ReviewsOverview } from '@/lib/finance-reviews/load';
import DashboardCardHeader from './DashboardCardHeader';

export default function PlanningSnapshotCard() {
  const { data, error, isLoading } = useSWR<ReviewsOverview>('/api/reviews', fetchJson, { shouldRetryOnError: false });
  const active = data?.actionQueue.filter(item => item.state.status === 'planned' || item.state.status === 'in_progress') ?? [];
  const owner = data?.context.lookup.owners.find(item => item.id === data.context.data.ownerId);
  const unavailable = data ? Object.values(data.features).filter(feature => feature.status === 'unavailable').length : 0;

  return <Card><CardContent>
    <DashboardCardHeader title="Your next steps" subtitle={data ? `${data.context.data.preferredName}, focus on the actions that move your finances forward.` : 'Your spending, wealth, properties and pensions in one review.'}
      action={<Button component={Link} href="/review" size="small" variant="outlined" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 16 }} />}>Open review</Button>} />
    {isLoading && <Stack direction={{ xs: 'column', sm: 'row' }} gap={2}>{[0, 1, 2].map(key => <Skeleton key={key} variant="rounded" height={92} sx={{ flex: 1, borderRadius: '6px' }} />)}</Stack>}
    {error && <Alert severity="info">Your saved review and account evidence could not be loaded. Open the planning tools or check your account connection before assessing progress.</Alert>}
    {data && <>
      <Stack direction="row" gap={1.25} flexWrap="wrap" alignItems="center" sx={{ mb: 2 }}>
        <Chip size="small" variant="outlined" label={`${active.length} open action${active.length === 1 ? '' : 's'}`} />
        <Typography variant="caption">Household figures · personal owner: {owner?.name ?? 'choose in My context'}</Typography>
        <Typography variant="caption" sx={{ ml: { sm: 'auto' } }}>{data.context.data.nextReviewDate ? `Next review ${data.context.data.nextReviewDate}` : 'Next review date not set'}</Typography>
      </Stack>
      {unavailable > 0 && <Alert severity="warning" sx={{ mb: 2 }}>{unavailable} planning workspace{unavailable === 1 ? '' : 's'} could not be loaded. Review coverage notes before assessing your finances.</Alert>}
      <Grid container spacing={2}>{active.slice(0, 3).map(({ action, state }, index) => <Grid key={action.id} size={{ xs: 12, md: 4 }}>
        <Box sx={{ height: '100%', p: 1.75, border: 1, borderColor: 'divider', borderRadius: '6px', display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" gap={1} sx={{ mb: 1.25 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.secondary', textTransform: 'capitalize' }}>{String(index + 1).padStart(2, '0')} · {action.topic}</Typography>
            {state.evidenceChanged ? <Chip size="small" color="warning" label="Evidence changed" /> : state.status === 'in_progress' ? <Chip size="small" label="In progress" /> : action.priority === 'high' ? <Chip size="small" variant="outlined" label="Priority" /> : null}
          </Stack>
          <Typography variant="body2" sx={{ fontWeight: 600, lineHeight: 1.5 }}>{action.title}</Typography>
          <Typography variant="caption" sx={{ display: 'block', mt: 0.75, mb: 1.25, lineHeight: 1.55 }}>{action.evidence}</Typography>
          <Button component={Link} href={action.href} size="small" endIcon={<ArrowForwardRoundedIcon sx={{ fontSize: 15 }} />} sx={{ mt: 'auto', px: 0, alignSelf: 'flex-start' }}>{action.actionLabel}</Button>
        </Box>
      </Grid>)}</Grid>
      {active.length === 0 && <Typography variant="body2" color="text.secondary">No open actions in this recorded review. Completed actions do not certify that every financial risk is resolved.</Typography>}
    </>}
    <Stack direction="row" gap={0.5} flexWrap="wrap" sx={{ borderTop: 1, borderColor: 'divider', mt: 2, pt: 1.25 }}>
      <Button component={Link} href="/profile" size="small">My context</Button><Button component={Link} href="/plan" size="small">Financial plan</Button><Button component={Link} href="/debts" size="small">Debt plan</Button><Button component={Link} href="/portfolio" size="small">Holdings &amp; fees</Button>
    </Stack>
  </CardContent></Card>;
}
