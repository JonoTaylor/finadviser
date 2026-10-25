'use client';

import Link from 'next/link';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import { Alert, Box, Button, Card, CardContent, Chip, Skeleton, Stack, Typography } from '@mui/material';
import { categorizationActivitySchema, type CategorizationActivity } from '@/lib/categorization/activity-schema';
import { fetchJson } from '@/lib/http/client';
import MerchantResearchEvidence from './MerchantResearchEvidence';

const ACTIVITY_URL = '/api/categorization/activity';
type ActivityItem = CategorizationActivity['items'][number];

export function parseAutomaticCategorizationActivity(value: unknown): CategorizationActivity {
  const parsed = categorizationActivitySchema.safeParse(value);
  if (!parsed.success) throw new Error('Automatic category activity could not be verified. Refresh to see its current status.');
  return parsed.data;
}

export function automaticCategoryLabel(kind: ActivityItem['assignmentKind']): string {
  return kind === 'estimated' ? 'Estimated' : kind === 'broad' ? 'Details unknown' : 'Automatic';
}

export function automaticActivityAmount(amount: string | null, currency: string | null): string {
  if (amount === null) return 'Amount context unavailable';
  const value = new Decimal(amount);
  const [whole, fraction] = value.abs().toFixed(2).split('.');
  return `${currency ?? 'Currency not recorded'} ${value.isZero() ? '' : value.isNegative() ? '−' : '+'}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

function ActivityRecord({ item }: { item: ActivityItem }) {
  return <Box sx={{ py: 1.5, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={1} justifyContent="space-between" alignItems={{ sm: 'flex-start' }}>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={0.75} flexWrap="wrap" alignItems="center">
          <Typography component="h3" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{item.merchantName || item.description}</Typography>
          <Chip size="small" variant="outlined" label={automaticCategoryLabel(item.assignmentKind)} />
        </Stack>
        <Typography variant="body2" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{item.categoryName}</Typography>
        <Typography variant="caption" component="p" sx={{ mt: 0.25 }}>{item.date} · {automaticActivityAmount(item.amount, item.currency)}</Typography>
      </Box>
      <Button component={Link} href="/transactions" size="small" sx={{ flexShrink: 0, alignSelf: 'flex-start' }}>Refine in transactions</Button>
    </Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75, overflowWrap: 'anywhere' }}>{item.reason}</Typography>
    {item.evidence && <Box component="details" sx={{ mt: 1 }}><Box component="summary" sx={{ cursor: 'pointer', fontSize: '0.8125rem' }}>Merchant evidence</Box><MerchantResearchEvidence evidence={item.evidence} /></Box>}
  </Box>;
}

export function AutomaticCategorizationActivityContent({ data }: { data: CategorizationActivity }) {
  const total = data.counts.standard + data.counts.estimated + data.counts.broad;
  const observed = new Date(data.observedAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London' });
  return <>
    <Stack direction="row" gap={0.75} flexWrap="wrap" sx={{ mt: 2 }}>
      <Chip size="small" variant="outlined" color={total > 0 ? 'success' : 'default'} label={`${total} AI label${total === 1 ? '' : 's'} saved`} />
      <Chip size="small" variant="outlined" label={`${data.counts.estimated} estimated`} />
      <Chip size="small" variant="outlined" label={`${data.counts.broad} with details unknown`} />
    </Stack>
    {data.counts.broad > 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>Payments with unknown details remain in your spending totals under their broad category. You can refine them whenever useful.</Typography>}
    {total === 0 && <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>No AI category labels are recorded yet. Saved rules and recognised services may have organised other payments.</Typography>}
    {data.items.length > 0 && <Box component="details" sx={{ mt: 2 }}>
      <Box component="summary" sx={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>Recent automatic labels ({data.items.length})</Box>
      <Box sx={{ mt: 0.5 }}>{data.items.map(item => <ActivityRecord key={item.journalId} item={item} />)}</Box>
    </Box>}
    <Typography variant="caption" component="p" sx={{ mt: 1.5 }}>Estimated and broad categories are useful spending labels, with the reasoning kept here. They do not establish a purchase’s tax treatment.</Typography>
    <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>Checked {observed} UK time.</Typography>
  </>;
}

export default function AutomaticCategorizationActivity() {
  const { data, error, isLoading, mutate } = useSWR(ACTIVITY_URL,
    async url => parseAutomaticCategorizationActivity(await fetchJson<unknown>(url, { cache: 'no-store' })),
    { shouldRetryOnError: false });
  return <Card><CardContent>
    <Stack direction="row" gap={1.5} justifyContent="space-between" alignItems="flex-start" flexWrap="wrap">
      <Box sx={{ minWidth: 0, flex: 1 }}><Typography component="h2" variant="h6">Organised for you</Typography><Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>AI category labels are saved automatically. Refining a label is optional.</Typography></Box>
      <Button component={Link} href="/transactions" size="small" variant="outlined">View transactions</Button>
    </Stack>
    {isLoading && <Skeleton variant="rounded" height={64} sx={{ mt: 2 }} />}
    {error && <Alert severity="warning" sx={{ mt: 2 }} action={<Button size="small" onClick={() => void mutate()}>Refresh</Button>}>Automatic category activity is unavailable. {data ? 'The previous snapshot is shown below.' : 'No missing counts have been treated as zero.'}</Alert>}
    {data && <AutomaticCategorizationActivityContent data={data} />}
  </CardContent></Card>;
}
