'use client';

import { useMemo, useState, use } from 'react';
import Decimal from 'decimal.js';
import {
  Box, Typography, Card, CardContent, Button, Stack, TextField,
  MenuItem, Snackbar, Alert, CircularProgress, Divider, Chip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckRoundedIcon from '@mui/icons-material/CheckRounded';
import ContentPasteRoundedIcon from '@mui/icons-material/ContentPasteRounded';
import Link from 'next/link';
import useSWR from 'swr';
import { formatCurrency } from '@/lib/utils/formatting';
import { parseMortgagePayments } from '@/lib/properties/mortgage-payment-parser';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface InternalAccount {
  account_id: number;
  account_name: string;
  account_type: string;
  balance: string;
}

export default function BulkMortgagePaymentsPage({
  params,
}: {
  params: Promise<{ id: string; mortgageId: string }>;
}) {
  const { id, mortgageId } = use(params);
  const propertyId = parseInt(id, 10);
  const mortgageIdNum = parseInt(mortgageId, 10);

  const { data: property } = useSWR(`/api/properties/${id}`, fetcher);
  const { data: accountsData } = useSWR<InternalAccount[]>('/api/accounts?balances=true', fetcher);

  const mortgage = property?.mortgages?.find((m: { id: number }) => m.id === mortgageIdNum);
  const ownership = property?.ownership ?? [];

  const [pasted, setPasted] = useState('');
  const [fromAccountId, setFromAccountId] = useState<number | ''>('');
  const [payerOwnerId, setPayerOwnerId] = useState<number | ''>('');
  const [submitting, setSubmitting] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; severity: 'success' | 'error' | 'info'; message: string }>({
    open: false, severity: 'success', message: '',
  });

  const parsed = useMemo(() => parseMortgagePayments(pasted), [pasted]);

  // Auto-pick defaults: single owner -> select; primary ASSET -> from-account.
  // Done in render rather than useEffect so the user can override and the
  // override sticks; useEffect on `ownership.length` would clobber edits.
  const effectivePayerOwnerId =
    payerOwnerId !== '' ? payerOwnerId :
    ownership.length === 1 ? (ownership[0].owner_id as number) : '';
  const effectiveFromAccountId =
    fromAccountId !== '' ? fromAccountId :
    (() => {
      const assets = (accountsData ?? []).filter(a => a.account_type === 'ASSET');
      return assets.length === 1 ? assets[0].account_id : '';
    })();

  const totalAmount = useMemo(() => {
    // Sum with Decimal rather than parseFloat so accumulated
    // floating-point error doesn't make the preview total drift on
    // long lists. Returned as a string formatted to 2dp; the
    // formatCurrency call below tolerates strings.
    return parsed.valid
      .reduce((sum, p) => sum.plus(new Decimal(p.amount)), new Decimal(0))
      .toFixed(2);
  }, [parsed.valid]);

  async function handleSubmit() {
    if (!mortgage) return;
    if (effectivePayerOwnerId === '' || effectiveFromAccountId === '') {
      setSnack({ open: true, severity: 'error', message: 'Pick a payer and a "Paid from" account first.' });
      return;
    }
    if (parsed.valid.length === 0) {
      setSnack({ open: true, severity: 'error', message: 'No valid payments to record.' });
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${id}/mortgages/payments-bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mortgageId: mortgageIdNum,
          payerOwnerId: effectivePayerOwnerId,
          fromAccountId: effectiveFromAccountId,
          payments: parsed.valid.map(p => ({ date: p.date, amount: p.amount })),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      setSnack({
        open: true,
        severity: 'success',
        message: `Added ${body.added} payment${body.added === 1 ? '' : 's'}; ${body.duplicates} duplicate${body.duplicates === 1 ? '' : 's'} skipped${body.errors > 0 ? `; ${body.errors} errored` : ''}.`,
      });
      // Clear the textarea so a follow-up paste doesn't re-submit.
      setPasted('');
    } catch (e) {
      setSnack({
        open: true,
        severity: 'error',
        message: e instanceof Error ? e.message : 'Failed to record payments',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (!property) {
    return <Box sx={{ p: 3 }}><CircularProgress size={32} /></Box>;
  }
  if (!mortgage) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          Mortgage {mortgageIdNum} not found on this property.
        </Alert>
      </Box>
    );
  }

  return (
    <Box>
      <Button component={Link} href={`/properties/${id}`} startIcon={<ArrowBackIcon />} sx={{ mb: 2 }}>
        Back to {property.name}
      </Button>

      <Typography variant="h4" sx={{ mb: 1 }}>Bulk add mortgage payments</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        {mortgage.lender}{mortgage.interestOnly ? ' · interest-only' : ''}.
        Paste a list of payment lines in the format your lender exports
        (date, amount, type). Rejected payments are skipped automatically.
      </Typography>

      <Stack spacing={3}>
        <Card>
          <CardContent>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, mb: 2 }}>Settings</Typography>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                select
                label="Paid from"
                size="small"
                fullWidth
                value={effectiveFromAccountId}
                onChange={e => setFromAccountId(e.target.value === '' ? '' : Number(e.target.value))}
                helperText="The account each payment debits"
              >
                {(accountsData ?? [])
                  .filter(a => a.account_type === 'ASSET')
                  .map(a => (
                    <MenuItem key={a.account_id} value={a.account_id}>
                      {a.account_name} ({formatCurrency(a.balance)})
                    </MenuItem>
                  ))}
              </TextField>
              <TextField
                select
                label="Payer"
                size="small"
                fullWidth
                value={effectivePayerOwnerId}
                onChange={e => setPayerOwnerId(e.target.value === '' ? '' : Number(e.target.value))}
                helperText="Owner whose capital account the principal credits (skipped on interest-only)"
              >
                {ownership.map((o: { owner_id: number; owner_name: string }) => (
                  <MenuItem key={o.owner_id} value={o.owner_id}>{o.owner_name}</MenuItem>
                ))}
              </TextField>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
              <ContentPasteRoundedIcon fontSize="small" color="action" />
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>Payment list</Typography>
            </Box>
            <TextField
              multiline
              minRows={6}
              fullWidth
              value={pasted}
              onChange={e => setPasted(e.target.value)}
              placeholder="31/12/2025 Receipt £1,382.36 Credit 28/11/2025 Receipt £1,382.36 Credit ..."
              sx={{
                '& textarea': {
                  fontFamily: 'monospace',
                  fontSize: '0.85rem',
                },
              }}
            />
          </CardContent>
        </Card>

        {pasted.trim().length > 0 && (
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                  Preview
                </Typography>
                <Stack direction="row" spacing={1}>
                  <Chip
                    label={`${parsed.valid.length} valid · ${formatCurrency(totalAmount)}`}
                    size="small"
                    color="success"
                  />
                  {parsed.skipped.length > 0 && (
                    <Chip label={`${parsed.skipped.length} skipped`} size="small" />
                  )}
                  {parsed.unparsed.length > 0 && (
                    <Chip label={`${parsed.unparsed.length} unparsed`} size="small" color="warning" />
                  )}
                </Stack>
              </Box>

              {parsed.valid.length > 0 && (
                <Box sx={{ mt: 1.5 }}>
                  <Stack divider={<Divider />} spacing={0}>
                    {parsed.valid.slice(0, 50).map((p, i) => (
                      <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.6 }}>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>{p.date}</Typography>
                        <Typography variant="body2" sx={{ fontFamily: 'monospace', fontWeight: 600 }}>
                          {formatCurrency(p.amount)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                  {parsed.valid.length > 50 && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                      ... and {parsed.valid.length - 50} more
                    </Typography>
                  )}
                </Box>
              )}

              {parsed.skipped.length > 0 && (
                <Box sx={{ mt: 2, opacity: 0.6 }}>
                  <Typography variant="caption" color="text.secondary">Skipped:</Typography>
                  {parsed.skipped.map((p, i) => (
                    <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4 }}>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {p.date} ({p.reason})
                      </Typography>
                      <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
                        {formatCurrency(p.amount)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {parsed.unparsed.length > 0 && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="warning.main">
                    Could not parse {parsed.unparsed.length} chunk{parsed.unparsed.length === 1 ? '' : 's'} -
                    they will not be submitted.
                  </Typography>
                </Box>
              )}
            </CardContent>
          </Card>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
          <Button component={Link} href={`/properties/${id}`}>Cancel</Button>
          <Button
            variant="contained"
            startIcon={<CheckRoundedIcon />}
            onClick={handleSubmit}
            disabled={
              submitting ||
              parsed.valid.length === 0 ||
              effectivePayerOwnerId === '' ||
              effectiveFromAccountId === ''
            }
          >
            {submitting ? 'Recording...' : `Record ${parsed.valid.length} payment${parsed.valid.length === 1 ? '' : 's'}`}
          </Button>
        </Box>
      </Stack>

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={snack.severity} variant="filled" onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
