'use client';

import { useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Skeleton, Stack, Typography } from '@mui/material';
import { fetchJson } from '@/lib/http/client';
import type { CategorizationLeg } from '@/lib/categorization/types';
import type { ReviewItem, ReviewQueue } from '@/lib/categorization/review';
import { buildCategoryLabels } from './categoryLabels';
import MerchantResearchEvidence from './MerchantResearchEvidence';

type ReviewAction = 'accept' | 'correct' | 'dismiss';
function postingAmount(amount: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(amount);
  if (!match) return amount;
  const whole = match[2].replace(/^0+(?=\d)/, '');
  const fraction = (match[3] ?? '').padEnd(2, '0');
  const nonzero = /[1-9]/.test(whole + fraction);
  return `${nonzero ? match[1] === '-' ? '−' : '+' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

function AccountPosting({ leg }: { leg: CategorizationLeg }) {
  return <Stack direction="row" gap={1} justifyContent="space-between" alignItems="flex-start" sx={{ py: 0.75, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
    <Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{leg.accountName}</Typography><Typography variant="caption">{leg.accountType.toLowerCase()} · {leg.ownerId === null ? 'Shared or unattributed' : 'Assigned owner'}</Typography></Box>
    <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', fontWeight: 600 }}>{postingAmount(leg.amount)}</Typography>
  </Stack>;
}

function ReviewRecord({ item, categories, labels, onReviewed, onReload }: { item: ReviewItem; categories: ReviewQueue['categories']; labels: Map<number, string>; onReviewed: () => Promise<void>; onReload: () => Promise<unknown> }) {
  const [categoryId, setCategoryId] = useState<number | ''>(item.suggestedCategoryId ?? '');
  const [remember, setRemember] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [stale, setStale] = useState(false);
  const pendingRef = useRef(false);
  const apply = async (action: ReviewAction) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setError('');
    setStale(false);
    try {
      const response = await fetch('/api/data-intelligence/review', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ journalId: item.journalId, snapshot: item.snapshot, action, ...(action === 'correct' ? { categoryId } : {}), ...(action === 'dismiss' ? {} : { remember }) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setStale(response.status === 409); throw new Error(typeof body?.error === 'string' ? body.error : 'Your review could not be saved. Please retry.'); }
      if (body?.success !== true || body.journalId !== item.journalId || body.action !== action) throw new Error('The review response could not be confirmed. Reload the current queue before trying again.');
      await onReviewed();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Your review could not be saved. Your selection has been kept.');
    } finally { pendingRef.current = false; setPending(false); }
  };
  const financialLegs = item.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY');
  const currency = item.currency;
  const propertyId = item.propertyId;
  return <Card aria-busy={pending}><CardContent>
    <GridlessRecord>
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 0.5 }}><Typography variant="caption">{item.date}</Typography>{item.merchantName && <Typography variant="caption" sx={{ overflowWrap: 'anywhere' }}>{item.merchantName}</Typography>}{propertyId !== null && <Chip component={Link} href={`/properties/${propertyId}`} clickable size="small" variant="outlined" label="Linked property" />}</Stack>
        <Typography component="h3" variant="subtitle2" sx={{ overflowWrap: 'anywhere', mb: 1 }}>{item.description}</Typography>
        <Typography variant="body2" sx={{ mb: 0.75, overflowWrap: 'anywhere' }}>{item.suggestedCategoryName ? <>Suggested category: <strong>{item.suggestedCategoryId !== null ? labels.get(item.suggestedCategoryId) ?? item.suggestedCategoryName : item.suggestedCategoryName}</strong></> : 'Choose a category; no supported match was found.'}</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{item.reason}</Typography>
        {item.confidence !== null && <Typography variant="caption" component="p" sx={{ mt: 0.75 }}>Confidence estimate: {Math.round(item.confidence * 100)}% · An estimate, not a verified probability.</Typography>}
        <MerchantResearchEvidence evidence={item.evidence} />
        <Box sx={{ mt: 1.5, p: 1.25, border: 1, borderColor: 'divider', bgcolor: '#F8FAFC', borderRadius: '6px' }}>
          <Typography variant="caption" component="p" sx={{ mb: 0.25 }}>Account postings · {currency ?? 'currency not recorded'} · signed amounts</Typography>
          {(financialLegs.length ? financialLegs : item.legs).map((leg, index) => <AccountPosting key={`${leg.accountId}-${index}`} leg={leg} />)}
          {item.legs.length === 0 && <Typography variant="body2">Account context unavailable.</Typography>}
        </Box>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <FormControl fullWidth size="small"><InputLabel id={`category-${item.journalId}`}>Confirm category</InputLabel><Select<number | ''> labelId={`category-${item.journalId}`} label="Confirm category" value={categoryId} onChange={event => setCategoryId(event.target.value === '' ? '' : Number(event.target.value))} disabled={pending}>
          <MenuItem value="" disabled>Choose category</MenuItem>{categoryId !== '' && !categories.some(category => category.id === categoryId) && <MenuItem value={categoryId} disabled>Category no longer available</MenuItem>}{categories.map(category => <MenuItem key={category.id} value={category.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{labels.get(category.id) ?? category.name}</MenuItem>)}
        </Select></FormControl>
        <FormControlLabel control={<Checkbox checked={remember} onChange={event => setRemember(event.target.checked)} disabled={pending} size="small" />} label={<Typography variant="body2">Remember this exact match for the same account context</Typography>} sx={{ mt: 1, alignItems: 'flex-start', ml: -0.75, '& .MuiCheckbox-root': { pt: 0.5 } }} />
        <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 1.5 }}>
          <Button variant="contained" disabled={pending || categoryId === '' || !categories.some(category => category.id === categoryId)} onClick={() => void apply(categoryId === item.suggestedCategoryId ? 'accept' : 'correct')}>{pending ? 'Saving…' : categoryId === item.suggestedCategoryId ? 'Approve category' : 'Save category'}</Button>
          <Button variant="outlined" disabled={pending} onClick={() => void apply('dismiss')}>Leave uncategorised</Button>
        </Stack>
        <Typography variant="caption" component="p" sx={{ mt: 1 }}>Leaving uncategorised removes this question from the queue. It does not change the transaction.</Typography>
      </Box>
    </GridlessRecord>
    {error && <Alert severity="error" sx={{ mt: 2 }}>{error} Your selected category is kept.{stale && <Button size="small" onClick={() => void onReload()} sx={{ display: 'block', mt: 0.5 }}>Reload current record</Button>}</Alert>}
  </CardContent></Card>;
}

function GridlessRecord({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'grid', gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1.3fr) minmax(0, 1fr)' }, gap: { xs: 2, lg: 3 } }}>{children}</Box>;
}

export default function CategorizationReviewQueue({ onReviewed }: { onReviewed: () => Promise<void> }) {
  const [cursors, setCursors] = useState<number[]>([]);
  const [announcement, setAnnouncement] = useState('');
  const queueHeading = useRef<HTMLHeadingElement>(null);
  const after = cursors.at(-1);
  const url = `/api/data-intelligence/review?limit=25${after ? `&afterId=${after}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR<ReviewQueue>(url, fetchJson, { shouldRetryOnError: false });
  const labels = useMemo(() => buildCategoryLabels(data?.categories ?? []), [data?.categories]);
  const refresh = async () => {
    await Promise.allSettled([mutate(), onReviewed()]);
    setAnnouncement('Your category review was saved.');
    queueHeading.current?.focus({ preventScroll: true });
  };
  return <>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1.5 }}><Typography variant="h6" component="h2" tabIndex={-1} ref={queueHeading} sx={{ '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 4, borderRadius: '3px' } }}>Decisions that need you</Typography>{data && <Chip size="small" variant="outlined" label={`${data.total} queued`} />}</Stack>
    <Box aria-live="polite" sx={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clipPath: 'inset(50%)' }}>{announcement}</Box>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Review the evidence, approve a suggestion or correct it. Learning from your decision is optional.</Typography>
    {isLoading && <Skeleton variant="rounded" height={200} />}
    {error && <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your review queue could not be loaded. No decisions have been assumed.</Alert>}
    {data && data.total === 0 && <Alert severity="info">No category questions are queued. Any records not yet processed are shown above.</Alert>}
    {data && data.total > 0 && data.items.length === 0 && <Alert severity="info">No questions remain on this page. Return to the first page to see the current queue.</Alert>}
    <Stack gap={1.5}>{data?.items.map(item => <ReviewRecord key={item.journalId} item={item} categories={data.categories} labels={labels} onReviewed={refresh} onReload={() => mutate()} />)}</Stack>
    {(cursors.length > 0 || data?.nextCursor) && <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
      {cursors.length > 0 && <Button variant="outlined" onClick={() => setCursors([])}>First page</Button>}
      {cursors.length > 0 && <Button onClick={() => setCursors(current => current.slice(0, -1))}>Previous</Button>}
      {data?.nextCursor && <Button variant="outlined" onClick={() => setCursors(current => [...current, data.nextCursor!])}>Next 25 questions</Button>}
    </Stack>}
  </>;
}
