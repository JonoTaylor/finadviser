'use client';

import { useMemo, useRef, useState, use } from 'react';
import Decimal from 'decimal.js';
import { z } from 'zod';
import {
  Box, Typography, Card, CardContent, Button, Stack, TextField,
  MenuItem, Alert, CircularProgress, Divider, Chip, Dialog, DialogTitle, DialogContent, DialogActions, Checkbox, FormControlLabel,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded';
import Link from 'next/link';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';
import { fetchJson } from '@/lib/http/client';
import { parseMortgagePayments } from '@/lib/properties/mortgage-payment-parser';

const propertySchema = z.object({
  name: z.string(),
  mortgages: z.array(z.object({ id: z.number(), lender: z.string(), interestOnly: z.boolean().optional() })),
  ownership: z.array(z.object({ owner_id: z.number(), owner_name: z.string() })),
});
const accountsSchema = z.array(z.object({
  account_id: z.number(), account_name: z.string(), account_type: z.string(), balance: z.string(),
}));
const paymentSchema = z.object({ date: z.string(), amount: z.string() });
const paymentErrorSchema = paymentSchema.extend({
  message: z.string(), code: z.string().optional(), existingJournalId: z.number().optional(), existingDate: z.string().optional(),
});
const resultSchema = z.object({
  added: z.number().int().nonnegative(), duplicates: z.number().int().nonnegative(), errors: z.number().int().nonnegative(),
  details: z.object({
    added: z.array(paymentSchema.extend({ journalId: z.number() })),
    duplicates: z.array(paymentSchema.extend({ existingJournalId: z.number().nullable() })),
    errors: z.array(paymentErrorSchema),
  }),
}).refine(value => value.added === value.details.added.length && value.duplicates === value.details.duplicates.length
  && value.errors === value.details.errors.length);
type ImportResult = z.infer<typeof resultSchema>;
type PaymentError = z.infer<typeof paymentErrorSchema>;
const dateReviewSchema = z.object({
  journalId: z.number(), mortgageId: z.number(), propertyId: z.number(), date: z.string(),
  amount: z.string().nullable(), reference: z.string().nullable(), correctDate: z.string(),
  expectedSnapshot: z.string().regex(/^[a-f0-9]{32}$/), canCorrect: z.boolean(), alreadyCorrected: z.boolean(), reason: z.string(),
  affectedTaxYears: z.array(z.string()).default([]), taxYearChanged: z.boolean().default(false),
});
type DateReview = z.infer<typeof dateReviewSchema>;
const correctionResultSchema = z.object({ corrected: z.boolean(), alreadyCorrected: z.boolean(), record: dateReviewSchema });

async function fetchProperty(url: string) {
  const data = propertySchema.safeParse(await fetchJson<unknown>(url));
  if (!data.success) throw new Error('The property and mortgage details could not be read.');
  return data.data;
}
async function fetchAccounts(url: string) {
  const data = accountsSchema.safeParse(await fetchJson<unknown>(url));
  if (!data.success) throw new Error('Payment account details could not be read.');
  return data.data;
}

export default function BulkMortgagePaymentsPage({
  params,
}: {
  params: Promise<{ id: string; mortgageId: string }>;
}) {
  const { id, mortgageId } = use(params);
  return <BulkMortgagePaymentsContent key={`${id}:${mortgageId}`} id={id} mortgageId={mortgageId} />;
}

function BulkMortgagePaymentsContent({ id, mortgageId }: { id: string; mortgageId: string }) {
  const mortgageIdNum = Number(mortgageId);
  const { data: property, error: propertyError, mutate: reloadProperty } = useSWR(`/api/properties/${id}`, fetchProperty);
  const { data: accountsData, error: accountsError, mutate: reloadAccounts } = useSWR('/api/accounts?balances=true', fetchAccounts);
  const mortgage = property?.mortgages.find(item => item.id === mortgageIdNum);
  const ownership = property?.ownership ?? [];
  const [pasted, setPasted] = useState('');
  const [fromAccountId, setFromAccountId] = useState<number | ''>('');
  const [payerOwnerId, setPayerOwnerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const pending = useRef(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultInputIssues, setResultInputIssues] = useState(0);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewTarget, setReviewTarget] = useState<PaymentError | null>(null);
  const [dateReview, setDateReview] = useState<DateReview | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewNeedsReload, setReviewNeedsReload] = useState(false);
  const [statementConfirmed, setStatementConfirmed] = useState(false);
  const [savedDates, setSavedDates] = useState<Record<number, string>>({});
  const reviewPending = useRef(false);
  const busy = submitting || reviewLoading;
  const correctionUrl = `/api/properties/${id}/mortgages/payment-date-correction`;
  const parsed = useMemo(() => parseMortgagePayments(pasted), [pasted]);
  const assets = (accountsData ?? []).filter(account => account.account_type === 'ASSET');
  const effectivePayerOwnerId = payerOwnerId !== '' ? payerOwnerId : ownership.length === 1 ? ownership[0].owner_id : '';
  const effectiveFromAccountId = fromAccountId !== '' ? fromAccountId : assets.length === 1 ? assets[0].account_id : '';
  const unresolvedResults = result?.details.errors.filter(error => !error.existingJournalId || savedDates[error.existingJournalId] !== error.date).length ?? 0;
  const totalAmount = useMemo(() => parsed.valid.reduce((sum, payment) => sum.plus(payment.amount), new Decimal(0)).toFixed(2), [parsed.valid]);

  async function handleSubmit() {
    if (!mortgage || pending.current || reviewPending.current || accountsError || !accountsData) return;
    if (effectivePayerOwnerId === '' || effectiveFromAccountId === '') {
      setSaveError('Pick a payer and a payment account first.');
      return;
    }
    if (!mortgage.interestOnly) {
      setSaveError('Use a verified principal and interest split for this mortgage. This paste flow is for interest-only payments.');
      return;
    }
    if (parsed.valid.length > 100) {
      setSaveError('Submit at most 100 payments at a time. Split the list into smaller batches; no entries have been submitted.');
      return;
    }
    if (parsed.valid.length === 0) {
      setSaveError('No valid payments to record. Check the listed parsing issues.');
      return;
    }
    pending.current = true;
    setSubmitting(true);
    setSaveError(null);
    try {
      const response = await fetch(`/api/properties/${id}/mortgages/payments-bulk`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mortgageId: mortgageIdNum, payerOwnerId: effectivePayerOwnerId, fromAccountId: effectiveFromAccountId,
          payments: parsed.valid.map(payment => ({ date: payment.date, amount: payment.amount })),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === 'string' ? body.error : 'The payment save could not be confirmed.');
      const checked = resultSchema.safeParse(body);
      if (!checked.success) throw new Error('The payment save returned unreadable results. Check recorded payments before retrying.');
      const submitted = new Map<string, number>();
      for (const payment of parsed.valid) {
        const key = `${payment.date}:${payment.amount}`;
        submitted.set(key, (submitted.get(key) ?? 0) + 1);
      }
      for (const payment of [...checked.data.details.added, ...checked.data.details.duplicates, ...checked.data.details.errors]) {
        const key = `${payment.date}:${payment.amount}`;
        const remaining = submitted.get(key) ?? 0;
        if (remaining < 1) throw new Error('Returned payment results do not match the submitted list. Check recorded payments before retrying.');
        submitted.set(key, remaining - 1);
      }
      if ([...submitted.values()].some(remaining => remaining !== 0)) {
        throw new Error('Some submitted payments were not accounted for in the response. Check recorded payments before retrying.');
      }
      setResult(checked.data);
      setResultInputIssues(parsed.unparsed.length);
      if (checked.data.errors === 0 && parsed.unparsed.length === 0) setPasted('');
    } catch (error) {
      setSaveError(`${error instanceof Error ? error.message : 'The payment save could not be confirmed.'} Your payment list and selections have been kept.`);
    } finally {
      pending.current = false;
      setSubmitting(false);
    }
  }

  async function loadDateReview(error: PaymentError) {
    if (!error.existingJournalId || reviewPending.current || pending.current) return;
    reviewPending.current = true;
    setReviewLoading(true);
    setReviewTarget(error);
    setStatementConfirmed(false);
    setReviewError(null);
    setReviewNeedsReload(false);
    setDateReview(null);
    try {
      const query = new URLSearchParams({ mortgageId: String(mortgageIdNum), journalId: String(error.existingJournalId), correctDate: error.date });
      const checked = dateReviewSchema.safeParse(await fetchJson<unknown>(`${correctionUrl}?${query}`));
      if (!checked.success || checked.data.journalId !== error.existingJournalId || checked.data.mortgageId !== mortgageIdNum
        || checked.data.propertyId !== Number(id) || checked.data.correctDate !== error.date || checked.data.amount !== error.amount) {
        throw new Error('The saved payment could not be verified. No date has been changed.');
      }
      setDateReview(checked.data);
      if (checked.data.alreadyCorrected) setSavedDates(previous => ({ ...previous, [checked.data.journalId]: checked.data.date }));
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'The saved payment could not be loaded.');
      setReviewNeedsReload(true);
    } finally {
      reviewPending.current = false;
      setReviewLoading(false);
    }
  }

  async function confirmDateCorrection() {
    if (!dateReview?.canCorrect || !statementConfirmed || reviewPending.current || reviewNeedsReload) return;
    reviewPending.current = true;
    setReviewLoading(true);
    setReviewError(null);
    try {
      const checked = correctionResultSchema.safeParse(await fetchJson<unknown>(correctionUrl, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mortgageId: mortgageIdNum, journalId: dateReview.journalId,
          correctDate: dateReview.correctDate, expectedSnapshot: dateReview.expectedSnapshot, confirmed: true }),
      }));
      if (!checked.success || (!checked.data.corrected && !checked.data.alreadyCorrected)
        || checked.data.record.journalId !== dateReview.journalId || checked.data.record.date !== dateReview.correctDate
        || checked.data.record.mortgageId !== mortgageIdNum || checked.data.record.propertyId !== Number(id)
        || checked.data.record.amount !== dateReview.amount) {
        throw new Error('The date correction could not be confirmed. Reload the saved payment before retrying.');
      }
      setDateReview(checked.data.record);
      setSavedDates(previous => ({ ...previous, [checked.data.record.journalId]: checked.data.record.date }));
      setStatementConfirmed(false);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : 'The date correction could not be confirmed.');
      setReviewNeedsReload(true);
    } finally {
      reviewPending.current = false;
      setReviewLoading(false);
    }
  }

  if (propertyError) return <Alert severity="error">{propertyError.message}
    <Button onClick={() => void reloadProperty()} size="small">Retry</Button>
  </Alert>;
  if (!property) return <Box sx={{ p: 3 }}><CircularProgress size={32} aria-label="Loading mortgage details" /></Box>;
  if (!mortgage) return <Alert severity="error">This mortgage was not found on the selected property.</Alert>;

  return <Box>
    <Button component={Link} href={`/properties/${id}`} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>Back to {property.name}</Button>
    <Typography variant="h4" component="h1" sx={{ mb: 1 }}>Add mortgage payments</Typography>
    <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
      {mortgage.lender}{mortgage.interestOnly ? ' · interest-only' : ''}. Paste the dates and amounts from your lender statement.
      Review the exact dates below. Rejected and debit entries are skipped.
    </Typography>
    <Stack spacing={3}>
      {!mortgage.interestOnly && <Alert severity="warning">This mortgage is not marked as interest-only. Record payments with a verified principal and interest split instead of treating the full amount as interest.
        <Button component={Link} href={`/properties/${id}`} size="small">Open property payments</Button>
      </Alert>}
      {parsed.valid.length > 100 && <Alert severity="warning">This list contains {parsed.valid.length} valid payments. Submit at most 100 at a time by splitting your list into smaller batches. No entries will be silently dropped.</Alert>}
      {accountsError && <Alert severity="error">{accountsError.message} Your entries are kept.
        <Button onClick={() => void reloadAccounts()} size="small">Retry accounts</Button>
      </Alert>}
      <Card><CardContent>
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 2 }}>Payment details</Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField select label="Paid from" size="small" fullWidth value={effectiveFromAccountId}
            onChange={event => setFromAccountId(event.target.value === '' ? '' : Number(event.target.value))}
            disabled={busy || !accountsData || Boolean(accountsError)} helperText="The account each payment debits">
            {assets.map(account => <MenuItem key={account.account_id} value={account.account_id}>
              {account.account_name} ({formatCurrency(account.balance)})
            </MenuItem>)}
          </TextField>
          <TextField select label="Payer" size="small" fullWidth value={effectivePayerOwnerId}
            onChange={event => setPayerOwnerId(event.target.value === '' ? '' : Number(event.target.value))}
            disabled={busy} helperText="Owner making these payments">
            {ownership.map(owner => <MenuItem key={owner.owner_id} value={owner.owner_id}>{owner.owner_name}</MenuItem>)}
          </TextField>
        </Stack>
      </CardContent></Card>
      <Card><CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <ContentPasteRoundedIcon fontSize="small" color="action" /><Typography variant="subtitle1" fontWeight={600}>Payment list</Typography>
        </Stack>
        <TextField label="Statement payment lines" multiline minRows={6} fullWidth value={pasted} disabled={busy}
          onChange={event => setPasted(event.target.value)}
          placeholder="30/09/2026 Receipt £1,861.22 Credit"
          helperText="UK dates (DD/MM/YYYY) and a £ amount. Lines may be separated by spaces or newlines."
          sx={{ '& textarea': { fontFamily: 'monospace', fontSize: '0.85rem' } }} />
      </CardContent></Card>
      {pasted.trim().length > 0 && <Card><CardContent>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between" sx={{ mb: 1 }}>
          <Typography variant="subtitle1" fontWeight={600}>Preview</Typography>
          <Stack direction="row" gap={1} flexWrap="wrap">
            <Chip label={`${parsed.valid.length} valid · ${formatCurrency(totalAmount)}`} size="small" color="success" />
            {parsed.skipped.length > 0 && <Chip label={`${parsed.skipped.length} skipped`} size="small" />}
            {parsed.unparsed.length > 0 && <Chip label={`${parsed.unparsed.length} need attention`} size="small" color="warning" />}
          </Stack>
        </Stack>
        <Stack divider={<Divider />}>
          {parsed.valid.slice(0, 50).map((payment, index) => <PaymentLine key={index} date={payment.date} amount={payment.amount} />)}
        </Stack>
        {parsed.valid.length > 50 && <Typography variant="caption" color="text.secondary">Showing the first 50 of {parsed.valid.length} valid payments.</Typography>}
        {parsed.skipped.length > 0 && <Box sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Skipped entries</Typography>
          {parsed.skipped.slice(0, 50).map((payment, index) => <PaymentLine key={index} date={payment.date} amount={payment.amount} note={payment.reason} />)}
        </Box>}
        {parsed.unparsed.length > 0 && <Alert severity="warning" sx={{ mt: 2 }}>
          <Typography variant="body2" fontWeight={600}>These entries will not be submitted</Typography>
          {(parsed.issues ?? parsed.unparsed.map(raw => ({ raw, message: 'Check the date and the complete £ amount.' }))).slice(0, 20).map((issue, index) => <Box key={index} sx={{ mt: 1 }}>
            <Typography variant="body2">{issue.message}</Typography>
            <Typography variant="caption" component="div" sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}>{issue.raw.slice(0, 500)}</Typography>
          </Box>)}
          {parsed.unparsed.length > 20 && <Typography variant="caption">Showing the first 20 of {parsed.unparsed.length} issues.</Typography>}
        </Alert>}
      </CardContent></Card>}
      {saveError && <Alert severity="error">{saveError}</Alert>}
      {result && <Card><CardContent>
        <Typography variant="h6" sx={{ mb: 1 }}>Last confirmed import</Typography>
        <Alert severity={unresolvedResults > 0 || resultInputIssues > 0 ? 'warning' : 'success'} sx={{ mb: 2 }}>
          {result.added} added · {result.duplicates} already recorded · {unresolvedResults} need review.
          {unresolvedResults > 0 && ' Your pasted list has been kept. Review these records before retrying.'}
          {resultInputIssues > 0 && ` ${resultInputIssues} ${resultInputIssues === 1 ? 'entry was' : 'entries were'} not submitted because ${resultInputIssues === 1 ? 'it could' : 'they could'} not be parsed; your list has been kept.`}
        </Alert>
        {result.details.added.length > 0 && <Box sx={{ mb: 2 }}><Typography variant="subtitle2">Added</Typography>
          {result.details.added.slice(0, 100).map(payment => <PaymentLine key={payment.journalId} {...payment} note={`Transaction ${payment.journalId}`} />)}
        </Box>}
        {result.details.duplicates.length > 0 && <Box sx={{ mb: 2 }}><Typography variant="subtitle2">Already recorded</Typography>
          {result.details.duplicates.slice(0, 100).map((payment, index) => <PaymentLine key={index} {...payment}
            note={payment.existingJournalId === null ? 'Repeated in this list' : `Transaction ${payment.existingJournalId}`} />)}
        </Box>}
        {result.details.errors.slice(0, 100).map((error, index) => <PaymentReview key={`${error.date}:${index}`} error={error}
          correctedDate={error.existingJournalId ? savedDates[error.existingJournalId] : undefined}
          busy={busy} onReview={() => void loadDateReview(error)} />)}
        {Math.max(result.added, result.duplicates, result.errors) > 100 && <Typography variant="caption">Showing up to 100 entries in each section.</Typography>}
      </CardContent></Card>}
      <Stack direction="row" justifyContent="flex-end" spacing={1.5}>
        <Button component={Link} href={`/properties/${id}`} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={<CheckRoundedIcon />} onClick={() => void handleSubmit()}
          disabled={busy || !mortgage.interestOnly || parsed.valid.length > 100 || parsed.valid.length === 0 || effectivePayerOwnerId === '' || effectiveFromAccountId === '' || !accountsData || Boolean(accountsError)}>
          {submitting ? 'Recording…' : `Record ${parsed.valid.length} payment${parsed.valid.length === 1 ? '' : 's'}`}
        </Button>
      </Stack>
    </Stack>
    <Dialog open={reviewTarget !== null} onClose={() => { if (!reviewLoading) setReviewTarget(null); }} maxWidth="sm" fullWidth>
      <DialogTitle>Review recorded payment date</DialogTitle>
      <DialogContent>
        {reviewLoading && <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}><CircularProgress size={18} /><Typography variant="body2">Checking the saved payment…</Typography></Stack>}
        {reviewError && <Alert severity="error" sx={{ mb: 2 }}>{reviewError} No successful date correction has been confirmed.</Alert>}
        {dateReview && <Stack spacing={2}>
          <Typography variant="body2">Transaction {dateReview.journalId}{dateReview.amount ? ` · ${formatCurrency(dateReview.amount)}` : ''}</Typography>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
            <Box><Typography variant="caption" color="text.secondary">Currently recorded</Typography><Typography fontWeight={600}>{dateReview.date}</Typography></Box>
            <Box><Typography variant="caption" color="text.secondary">Date in your submitted list</Typography><Typography fontWeight={600}>{dateReview.correctDate}</Typography></Box>
          </Box>
          <Alert severity={dateReview.alreadyCorrected ? 'success' : 'info'}>{dateReview.reason}</Alert>
          {dateReview.taxYearChanged && <Alert severity="warning">This date crosses a tax-year boundary. Recalculate {dateReview.affectedTaxYears.join(' and ')} before using these figures for filing.
            <Button component={Link} href={`/properties/${id}`} size="small">Review property tax reports</Button>
          </Alert>}
          {dateReview.canCorrect && <>
            <Typography variant="body2" color="text.secondary">This could be a separate payment. Check your lender statement before changing the date. The payment amount and accounts stay the same.</Typography>
            <FormControlLabel control={<Checkbox checked={statementConfirmed} onChange={event => setStatementConfirmed(event.target.checked)} disabled={reviewLoading || reviewNeedsReload} />}
              label={`I checked my lender statement and confirm this payment belongs on ${dateReview.correctDate}.`} />
          </>}
        </Stack>}
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
        <Button disabled={reviewLoading} onClick={() => setReviewTarget(null)}>{dateReview?.alreadyCorrected ? 'Done' : 'Cancel'}</Button>
        {reviewNeedsReload && reviewTarget && <Button disabled={reviewLoading} onClick={() => void loadDateReview(reviewTarget)}>Reload saved payment</Button>}
        {dateReview?.canCorrect && <Button variant="contained" disabled={reviewLoading || reviewNeedsReload || !statementConfirmed} onClick={() => void confirmDateCorrection()}>Confirm date correction</Button>}
      </DialogActions>
    </Dialog>
  </Box>;
}

function PaymentLine({ date, amount, note }: { date: string; amount: string; note?: string }) {
  return <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75 }}>
    <Box sx={{ minWidth: 0 }}><Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums' }}>{date}</Typography>
      {note && <Typography variant="caption" color="text.secondary">{note}</Typography>}
    </Box>
    <Typography variant="body2" fontWeight={600} sx={{ fontVariantNumeric: 'tabular-nums', flexShrink: 0 }}>{formatCurrency(amount)}</Typography>
  </Box>;
}

function PaymentReview({ error, correctedDate, busy, onReview }: {
  error: PaymentError; correctedDate?: string; busy: boolean; onReview: () => void;
}) {
  const resolved = correctedDate === error.date;
  return <Alert severity={resolved ? 'success' : 'warning'} sx={{ mt: 1 }}>
    <Typography variant="body2" fontWeight={600}>{error.date} · {formatCurrency(error.amount)}</Typography>
    <Typography variant="body2">{resolved ? `Saved date confirmed as ${correctedDate}. The payment amount is unchanged.` : error.message}</Typography>
    {error.existingJournalId && <Typography variant="caption" display="block">Recorded transaction {error.existingJournalId}{!resolved && error.existingDate ? ` · ${error.existingDate}` : ''}.</Typography>}
    {!resolved && error.code === 'possible_legacy_date' && error.existingJournalId
      ? <Button size="small" disabled={busy} onClick={onReview} sx={{ mt: 0.5 }}>Review saved date</Button>
      : !resolved && <Button component={Link} href="/transactions" size="small" sx={{ mt: 0.5 }}>Review transactions</Button>}
  </Alert>;
}
