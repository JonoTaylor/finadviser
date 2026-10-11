'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, Card, CardContent, Chip, Grid, Skeleton, Stack, Typography } from '@mui/material';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import { fetchJson } from '@/lib/http/client';
import type { ReviewsOverview } from '@/lib/finance-reviews/load';
import { softTokens } from '@/theme/theme';

export default function PlanningSnapshotCard() {
  const { data, error, isLoading } = useSWR<ReviewsOverview>('/api/reviews', fetchJson, { shouldRetryOnError: false });
  const active = data?.actionQueue.filter(item => item.state.status === 'planned' || item.state.status === 'in_progress') ?? [];
  const owner = data?.context.lookup.owners.find(item => item.id === data.context.data.ownerId);
  const unavailable = data ? Object.values(data.features).filter(feature => feature.status === 'unavailable').length : 0;
  return <Card sx={{ bgcolor: softTokens.cream }}><CardContent>
    <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" gap={2} alignItems={{ sm: 'center' }}>
      <Box><Typography variant="overline" sx={{ color: softTokens.mint.ink }}>THE NEXT STEP FOR YOUR MONEY</Typography><Typography variant="h5">{data ? `${data.context.data.preferredName}, your next steps` : 'Your finances, working together'}</Typography><Typography variant="body2" sx={{ mt: 1 }}>Reduce spending, build wealth and keep your properties and pensions on track.</Typography></Box>
      <Button component={Link} href="/review" variant="contained" endIcon={<ArrowForwardRoundedIcon />} sx={{ flexShrink: 0 }}>Review my next steps</Button>
    </Stack>
    {isLoading && <Skeleton sx={{ mt: 2 }} height={80} />}
    {error && <Alert severity="info" sx={{ mt: 2 }}>Your saved review and account evidence could not be loaded. Open the planning tools or check your account connection before assessing progress.</Alert>}
    {data && <>
      {unavailable > 0 && <Alert severity="warning" sx={{ mt: 2 }}>{unavailable} planning workspace{unavailable === 1 ? '' : 's'} could not be loaded. Review coverage notes before assessing your finances.</Alert>}
      <Typography variant="caption" sx={{ display: 'block', mt: 2 }}>Household figures · personal owner: {owner?.name ?? 'choose in My context'} · {active.length} open action{active.length === 1 ? '' : 's'} · {data.context.data.nextReviewDate ? `next review ${data.context.data.nextReviewDate}` : 'set your next review date'}</Typography>
      <Grid container spacing={2} sx={{ mt: 1 }}>{active.slice(0, 3).map(({ action, state }) => <Grid key={action.id} size={{ xs: 12, md: 4 }}><Box sx={{ p: 2, bgcolor: 'background.paper', borderRadius: 3, height: '100%' }}><Chip size="small" label={state.evidenceChanged ? 'Evidence changed' : action.topic} sx={{ mb: 1 }} /><Typography variant="body2" fontWeight={600}>{action.title}</Typography><Typography variant="caption" sx={{ display: 'block', mt: 1 }}>{action.evidence}</Typography><Button component={Link} href={action.href} size="small" sx={{ mt: 1 }}>{action.actionLabel}</Button></Box></Grid>)}</Grid>
      {active.length === 0 && <Typography variant="body2" sx={{ mt: 2 }}>No open actions in this recorded review. Completed actions do not certify that every financial risk is resolved.</Typography>}
    </>}
    <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}><Button component={Link} href="/profile" size="small">My context</Button><Button component={Link} href="/plan" size="small">Financial plan</Button><Button component={Link} href="/debts" size="small">Debt plan</Button><Button component={Link} href="/portfolio" size="small">Holdings &amp; fees</Button></Stack>
  </CardContent></Card>;
}
