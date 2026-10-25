'use client';

import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import Decimal from 'decimal.js';
import { z } from 'zod';
import { Alert, Box, Button, Card, CardContent, Checkbox, Chip, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Skeleton, Stack, Typography } from '@mui/material';
import type { ReviewGroup, ReviewGroupsQueue } from '@/lib/categorization/review-groups';
import { fetchJson } from '@/lib/http/client';
import { buildCategoryLabels } from './categoryLabels';
import MerchantResearchEvidence from './MerchantResearchEvidence';
import RememberPayeeDialog from './RememberPayeeDialog';

// Keep this structural response check in the browser. The backend module also
// imports database code and must never be included in the client bundle.
const identifier = z.number().int().positive();
const hash = z.string().regex(/^[a-f0-9]{32}$/);
const sourceSchema = z.object({ title: z.string(), url: z.string(), snippet: z.string(), retrievedAt: z.string() }).strict();
const evidenceSchema = z.object({
  status: z.enum(['matched', 'no_matches', 'unavailable', 'timed_out', 'skipped_private']),
  query: z.string().nullable(), sources: z.array(sourceSchema).max(3), researchedAt: z.string(),
  provider: z.literal('gateway_perplexity'), scope: z.literal('merchant_identity_only'),
}).strict();
const itemSchema = z.object({
  journalId: identifier, date: z.string(), description: z.string(), merchantName: z.string().nullable(),
  currency: z.string().nullable(), propertyId: identifier.nullable(),
  legs: z.array(z.object({
    accountId: identifier, accountName: z.string(), accountType: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE']),
    ownerId: identifier.nullable(), amount: z.string().regex(/^-?\d+(?:\.\d+)?$/),
  }).strict()),
  suggestedCategoryId: identifier.nullable(), suggestedCategoryName: z.string().nullable(),
  confidence: z.number().finite().min(0).max(1).nullable(), reason: z.string(), evidence: evidenceSchema.nullable(),
  snapshot: hash, updatedAt: z.string(), reviewVersion: hash,
}).strict();
const groupSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/), items: z.array(itemSchema).min(1).max(100),
  paymentCount: z.number().int().positive(), hasMore: z.boolean(),
}).strict().superRefine((group, context) => {
  if (new Set(group.items.map(item => item.journalId)).size !== group.items.length
    || group.paymentCount < group.items.length || group.hasMore !== (group.paymentCount > group.items.length)) {
    context.addIssue({ code: 'custom', message: 'Payment group membership could not be verified.' });
  }
});
const queueSchema = z.object({
  groups: z.array(groupSchema).max(15), totalPayments: z.number().int().nonnegative(), totalGroups: z.number().int().nonnegative(),
  nextCursor: z.string().regex(/^[a-f0-9]{64}$/).nullable(), hasMore: z.boolean(),
  categories: z.array(z.object({ id: identifier, name: z.string(), parentId: identifier.nullable() }).strict()),
}).strict().superRefine((queue, context) => {
  if (new Set(queue.groups.map(group => group.key)).size !== queue.groups.length
    || queue.groups.length > queue.totalGroups || queue.totalGroups > queue.totalPayments
    || queue.groups.reduce((sum, group) => sum + group.paymentCount, 0) > queue.totalPayments
    || queue.hasMore !== (queue.nextCursor !== null)
    || (queue.hasMore && (queue.groups.length === 0 || queue.nextCursor !== queue.groups.at(-1)?.key))) {
    context.addIssue({ code: 'custom', message: 'Payment question totals or page boundaries could not be verified.' });
  }
});

export function parseReviewGroups(value: unknown): ReviewGroupsQueue {
  const parsed = queueSchema.safeParse(value);
  if (!parsed.success) throw new Error('The grouped review queue could not be verified. Reload before making a decision.');
  return parsed.data;
}

export async function fetchReviewGroups(url: string): Promise<ReviewGroupsQueue> {
  return parseReviewGroups(await fetchJson<unknown>(url, { cache: 'no-store' }));
}

export function signedPaymentAmount(value: string): string {
  const amount = new Decimal(value);
  const fixed = amount.abs().toFixed(2);
  const [whole, fraction] = fixed.split('.');
  return `${amount.isZero() ? '' : amount.isNegative() ? '−' : '+'}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction}`;
}

export function groupSuggestedCategory(group: ReviewGroup): number | null {
  const first = group.items[0].suggestedCategoryId;
  return first !== null && group.items.every(item => item.suggestedCategoryId === first) ? first : null;
}

export function groupNeedsMovementReview(group: ReviewGroup): boolean {
  return group.items.some(item => /\b(?:transfers?|repayments?|savings|liability|account movement|investment deposits?)\b/i.test(item.reason)
    || /^(?:american exp(?:ress)?(?:\s|$)|amex(?:\s|$)|fnz$)/i.test(item.merchantName?.trim() ?? ''));
}

export function groupPreviewSummary(group: ReviewGroup): { dateRange: string; amount: string | null; currency: string | null; accountNames: string[] } {
  const dates = group.items.map(item => item.date).sort();
  const financialLegs = group.items.map(item => item.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY'));
  const currencies = new Set(group.items.map(item => item.currency));
  const oneLeg = financialLegs.every(legs => legs.length === 1);
  return {
    dateRange: dates[0] === dates.at(-1) ? dates[0] : `${dates[0]} to ${dates.at(-1)}`,
    amount: oneLeg && currencies.size === 1 ? signedPaymentAmount(Decimal.sum(...financialLegs.map(legs => legs[0].amount)).toString()) : null,
    currency: currencies.size === 1 ? group.items[0].currency : null,
    accountNames: [...new Set(financialLegs.flat().map(leg => leg.accountName))],
  };
}

type ReviewAction = 'accept' | 'correct' | 'dismiss';
type GroupResult = { success: true; groupKey: string; action: ReviewAction; categoryId: number | null; appliedCount: number; remembered: boolean; journalIds: number[] };
const resultSchema = z.object({
  success: z.literal(true), groupKey: z.string().regex(/^[a-f0-9]{64}$/), action: z.enum(['accept', 'correct', 'dismiss']),
  categoryId: identifier.nullable(), appliedCount: z.number().int().positive().max(100), remembered: z.boolean(), journalIds: z.array(identifier).min(1).max(100),
}).strict();

export function validateGroupAcknowledgement(value: unknown, group: ReviewGroup, action: ReviewAction, categoryId: number | null, remember: boolean): GroupResult {
  const parsed = resultSchema.safeParse(value);
  const expectedIds = group.items.map(item => item.journalId).sort((a, b) => a - b);
  if (!parsed.success || parsed.data.groupKey !== group.key || parsed.data.action !== action || parsed.data.categoryId !== categoryId
    || parsed.data.appliedCount !== expectedIds.length || parsed.data.remembered !== (remember && action !== 'dismiss')
    || JSON.stringify([...parsed.data.journalIds].sort((a, b) => a - b)) !== JSON.stringify(expectedIds)) {
    throw new Error('The saved decision could not be confirmed. Reload the current queue to check recorded changes before trying again.');
  }
  return parsed.data;
}

type Selection = { group: ReviewGroup; categories: ReviewGroupsQueue['categories'] };
type RememberChoice = { journalId: number; categoryId: number; categoryLabel: string };

export function freezeReviewSelection(group: ReviewGroup, categories: ReviewGroupsQueue['categories']): Selection {
  return structuredClone({ group, categories });
}

export function GroupReviewCard({ group, onOpen }: { group: ReviewGroup; onOpen: () => void }) {
  const item = group.items[0];
  const summary = groupPreviewSummary(group);
  const movement = groupNeedsMovementReview(group);
  return <Card><CardContent>
    <Stack direction={{ xs: 'column', sm: 'row' }} gap={2} alignItems={{ sm: 'center' }} justifyContent="space-between">
      <Box sx={{ minWidth: 0 }}>
        <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap"><Typography component="h3" variant="subtitle2" sx={{ overflowWrap: 'anywhere' }}>{item.merchantName || item.description}</Typography><Chip size="small" variant="outlined" label={`${group.paymentCount} payment${group.paymentCount === 1 ? '' : 's'}`} />{movement && <Chip size="small" variant="outlined" color="warning" label="Check account movement" />}</Stack>
        {item.merchantName && <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, overflowWrap: 'anywhere' }}>{item.description}</Typography>}
        <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>{summary.accountNames.join(' · ') || 'Account context unavailable'} · {summary.dateRange}{group.hasMore ? ` · first ${group.items.length} shown` : ''}</Typography>
        {summary.amount !== null && <Typography variant="body2" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>{summary.currency ?? 'Currency not recorded'} {summary.amount} {group.hasMore ? 'in this preview' : 'total'}</Typography>}
      </Box>
      <Button variant="outlined" onClick={onOpen} sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}>Review {group.items.length === 1 ? 'payment' : `these ${group.items.length}`}</Button>
    </Stack>
  </CardContent></Card>;
}

function GroupReviewDialog({ selection, onClose, onSaved, onReload, onRemember }: { selection: Selection; onClose: () => void; onSaved: (result: GroupResult) => Promise<void>; onReload: () => Promise<void>; onRemember: (choice: RememberChoice) => void }) {
  // selection is captured on the explicit Review action. SWR updates only the
  // list behind this modal; they never replace or expand these submitted IDs.
  const { group, categories } = selection;
  const labels = useMemo(() => buildCategoryLabels(categories), [categories]);
  const suggestedId = groupSuggestedCategory(group);
  const [categoryId, setCategoryId] = useState<number | ''>(suggestedId ?? '');
  const [remember, setRemember] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [requiresReload, setRequiresReload] = useState(false);
  const writing = useRef(false);
  const summary = groupPreviewSummary(group);
  const movement = groupNeedsMovementReview(group);
  const first = group.items[0];
  const apply = async (action: ReviewAction) => {
    if (writing.current || requiresReload || (action !== 'dismiss' && categoryId === '')) return;
    writing.current = true; setPending(true); setError('');
    try {
      const body = await fetchJson<unknown>('/api/data-intelligence/review-groups', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupKey: group.key, items: group.items.map(item => ({ journalId: item.journalId, snapshot: item.snapshot, reviewVersion: item.reviewVersion })),
          action, ...(action === 'correct' ? { categoryId } : {}), remember: action !== 'dismiss' && remember }),
      });
      const result = validateGroupAcknowledgement(body, group, action, action === 'dismiss' ? null : Number(categoryId), remember);
      await onSaved(result);
    } catch (cause) {
      setRequiresReload(true);
      setError(cause instanceof Error ? cause.message : 'This decision could not be confirmed. Reload the queue to check recorded changes before trying again.');
    } finally { writing.current = false; setPending(false); }
  };
  return <Dialog open onClose={() => { if (!writing.current) onClose(); }} disableEscapeKeyDown={pending} fullWidth maxWidth="md" aria-labelledby="group-review-title">
    <DialogTitle id="group-review-title">One decision for {group.items.length} payment{group.items.length === 1 ? '' : 's'}</DialogTitle>
    <DialogContent>
      <Typography component="h3" variant="subtitle1" sx={{ overflowWrap: 'anywhere' }}>{first.merchantName || first.description}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>These payments have the same exact description and account context. Your choice applies only to the payments listed below.</Typography>
      <Typography variant="body2" sx={{ mt: 1 }}>{summary.dateRange} · {summary.accountNames.join(' · ') || 'Account context unavailable'}{summary.amount !== null ? ` · ${summary.currency ?? 'Currency not recorded'} ${summary.amount} total` : ''}</Typography>
      {first.propertyId !== null && <Chip component={Link} href={`/properties/${first.propertyId}`} clickable size="small" variant="outlined" label="Linked property" sx={{ mt: 1 }} />}
      {group.hasMore && <Alert severity="info" sx={{ mt: 1.5 }}>This group has {group.paymentCount} payments. Only these {group.items.length} are in this preview; the remaining payments stay in the queue.</Alert>}
      {movement && <Alert severity="info" sx={{ mt: 1.5 }}>These payments may be repayments, savings or transfers. Check the destination account before treating them as spending.<Button component={Link} href="/transactions/transfers" size="small" sx={{ display: 'block', width: 'fit-content', mt: 0.5 }}>Review account movements</Button></Alert>}
      <Box component="details" open sx={{ mt: 2, border: 1, borderColor: 'divider', borderRadius: 1 }}>
        <Box component="summary" sx={{ px: 1.5, py: 1, cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>Payments included in this decision ({group.items.length})</Box>
        <Box sx={{ maxHeight: 260, overflowY: 'auto', px: 1.5, pb: 0.5 }}>{group.items.map(item => <Box key={item.journalId} sx={{ py: 1, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>{item.date}</Typography>
          <Typography variant="caption" component="p" sx={{ overflowWrap: 'anywhere' }}>{item.description}</Typography>
          {item.legs.filter(leg => leg.accountType === 'ASSET' || leg.accountType === 'LIABILITY').map((leg, index) => <Stack key={`${leg.accountId}-${index}`} direction="row" gap={1} justifyContent="space-between" sx={{ mt: 0.25 }}><Typography variant="body2" sx={{ overflowWrap: 'anywhere' }}>{leg.accountName} · {leg.accountType.toLowerCase()} · {leg.ownerId === null ? 'Shared or unattributed' : 'Assigned owner'}</Typography><Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{item.currency ?? 'Currency not recorded'} {signedPaymentAmount(leg.amount)}</Typography></Stack>)}
          {groupSuggestedCategory({ ...group, items: [item] }) !== suggestedId && <Typography variant="caption" component="p">Different suggestion: {item.suggestedCategoryId === null ? 'No category' : labels.get(item.suggestedCategoryId) ?? item.suggestedCategoryName}</Typography>}
        </Box>)}</Box>
      </Box>
      <Box component="details" sx={{ mt: 1.5 }}><Box component="summary" sx={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>Why these payments need review</Box><Stack gap={1} sx={{ mt: 1 }}>{[...new Set(group.items.map(item => item.reason))].map(reason => <Typography key={reason} variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{reason}</Typography>)}</Stack></Box>
      {group.items.some(item => item.evidence) && <Box component="details" sx={{ mt: 1.5 }}><Box component="summary" sx={{ cursor: 'pointer', fontSize: '0.875rem', fontWeight: 600 }}>View merchant evidence</Box>{group.items.filter((item, index, items) => item.evidence && items.findIndex(other => JSON.stringify(other.evidence) === JSON.stringify(item.evidence)) === index).map(item => <MerchantResearchEvidence key={item.journalId} evidence={item.evidence} />)}</Box>}
      <FormControl fullWidth size="small" sx={{ mt: 2 }}><InputLabel id="group-category">Category for these payments</InputLabel><Select<number | ''> labelId="group-category" label="Category for these payments" value={categoryId} disabled={pending || requiresReload} onChange={event => setCategoryId(event.target.value === '' ? '' : Number(event.target.value))}>
        <MenuItem value="" disabled>Choose category</MenuItem>{categoryId !== '' && !categories.some(category => category.id === categoryId) && <MenuItem value={categoryId} disabled>Category no longer available</MenuItem>}{categories.map(category => <MenuItem key={category.id} value={category.id} sx={{ whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{labels.get(category.id) ?? category.name}</MenuItem>)}
      </Select></FormControl>
      {suggestedId === null && group.items.length > 1 && <Typography variant="caption" component="p" sx={{ mt: 0.5 }}>There is no shared supported suggestion. Choose a category after checking the listed payments.</Typography>}
      <FormControlLabel sx={{ mt: 1, alignItems: 'flex-start' }} control={<Checkbox checked={remember} onChange={event => setRemember(event.target.checked)} disabled={pending || requiresReload} size="small" />} label={<Typography variant="body2">Remember this exact payment context for future matches</Typography>} />
      <Typography variant="caption" component="p">Learning stays within the same account, owner, direction, currency and property context. For a person with changing references, use “Remember this payee” instead.</Typography>
      {error && <Alert severity="warning" sx={{ mt: 2 }}>{error} Your selection is kept. Reload the queue before trying again; reloading closes this preview.<Button size="small" disabled={pending} onClick={() => void onReload()} sx={{ display: 'block', mt: 0.5 }}>Reload current queue</Button></Alert>}
    </DialogContent>
    <DialogActions sx={{ flexWrap: 'wrap', justifyContent: 'space-between', gap: 1, px: 3, pb: 2 }}>
      <Box sx={{ maxWidth: 340 }}><Button variant="text" disabled={pending || requiresReload || categoryId === ''} onClick={() => { if (categoryId !== '') onRemember({ journalId: first.journalId, categoryId, categoryLabel: labels.get(categoryId) ?? 'Selected category' }); }}>Remember a payee with changing references</Button><Typography variant="caption" component="p" sx={{ px: 1 }}>Confirms the first listed payment and teaches future matches. The other payments stay queued until processing runs.</Typography></Box>
      <Stack direction="row" gap={1} flexWrap="wrap"><Button disabled={pending} onClick={onClose}>Cancel</Button><Button variant="outlined" disabled={pending || requiresReload} onClick={() => void apply('dismiss')}>Leave these uncategorised</Button><Button variant="contained" disabled={pending || requiresReload || categoryId === '' || !categories.some(category => category.id === categoryId)} onClick={() => void apply(categoryId === suggestedId ? 'accept' : 'correct')}>{pending ? 'Saving…' : `Apply to ${group.items.length} payment${group.items.length === 1 ? '' : 's'}`}</Button></Stack>
    </DialogActions>
  </Dialog>;
}

export default function GroupedCategorizationReviewQueue({ onReviewed }: { onReviewed: () => Promise<void> }) {
  const [cursors, setCursors] = useState<string[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rememberPayee, setRememberPayee] = useState<RememberChoice | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  const after = cursors.at(-1);
  const url = `/api/data-intelligence/review-groups?limit=15${after ? `&afterKey=${after}` : ''}`;
  const { data, error, isLoading, mutate } = useSWR(url, fetchReviewGroups, { shouldRetryOnError: false, revalidateOnFocus: false, revalidateOnReconnect: false });
  const refresh = async () => { await Promise.allSettled([mutate(), onReviewed()]); };
  const saved = async (result: GroupResult) => {
    setSelection(null);
    setAnnouncement(result.action === 'dismiss' ? `Left ${result.appliedCount} payments uncategorised.` : `Saved the category for ${result.appliedCount} payments${result.remembered ? ' and remembered this exact context' : ''}.`);
    await refresh();
    heading.current?.focus({ preventScroll: true });
  };
  const reload = async () => { setSelection(null); await refresh(); };
  return <>
    <Stack direction="row" gap={1} alignItems="center" flexWrap="wrap" sx={{ mb: 1 }}><Typography component="h2" variant="h6" tabIndex={-1} ref={heading}>Decisions that need you</Typography>{data && <><Chip size="small" variant="outlined" label={`${data.totalGroups} question${data.totalGroups === 1 ? '' : 's'}`} /><Chip size="small" variant="outlined" label={`${data.totalPayments} payment${data.totalPayments === 1 ? '' : 's'}`} /></>}</Stack>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>Repeated payments with the same exact description and account context share one question. Open a group to check its payments and decide once.</Typography>
    {announcement && <Alert severity="success" role="status" sx={{ mb: 2 }}>{announcement}</Alert>}
    {isLoading && <Skeleton variant="rounded" height={180} />}
    {error && <Alert severity="warning" sx={{ mb: 2 }} action={<Button size="small" onClick={() => void mutate()}>Reload</Button>}>The grouped review queue could not be loaded. No decisions have been assumed.</Alert>}
    {data?.totalPayments === 0 && <Alert severity="info">No category questions are queued. Any records not yet processed are shown above.</Alert>}
    {data && data.totalPayments > 0 && data.groups.length === 0 && <Alert severity="info">No questions remain on this page. Return to the first page to see the current queue.</Alert>}
    <Stack gap={1.5}>{data?.groups.map(group => <GroupReviewCard key={group.key} group={group} onOpen={() => { setSelection(freezeReviewSelection(group, data.categories)); }} />)}</Stack>
    {selection && <GroupReviewDialog key={selection.group.key} selection={selection} onClose={() => setSelection(null)} onSaved={saved} onReload={reload} onRemember={choice => { setSelection(null); setRememberPayee(choice); }} />}
    <RememberPayeeDialog open={rememberPayee !== null} journalId={rememberPayee?.journalId ?? null} categoryId={rememberPayee?.categoryId ?? null} categoryLabel={rememberPayee?.categoryLabel ?? 'Selected category'} onClose={() => setRememberPayee(null)} onSaved={async () => { setAnnouncement('Your payment meaning was saved.'); await refresh(); }} />
    {(cursors.length > 0 || data?.hasMore) && <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mt: 2 }}>
      {cursors.length > 0 && <Button variant="outlined" onClick={() => setCursors([])}>First page</Button>}
      {cursors.length > 0 && <Button onClick={() => setCursors(current => current.slice(0, -1))}>Previous</Button>}
      {data?.hasMore && data.nextCursor && <Button variant="outlined" onClick={() => setCursors(current => [...current, data.nextCursor!])}>Next questions</Button>}
    </Stack>}
  </>;
}
