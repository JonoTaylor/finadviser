'use client';

import { useState, useEffect, use } from 'react';
import useSWR from 'swr';
import {
  Box, Typography, Card, CardContent, Button, Stack, Chip, Alert, IconButton,
  TextField, MenuItem, Snackbar, Dialog, DialogTitle, DialogContent, DialogActions, Divider,
} from '@mui/material';
import AccountBalanceRoundedIcon from '@mui/icons-material/AccountBalanceRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import { format } from 'date-fns';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { formatCurrency } from '@/lib/utils/formatting';
import { softTokens } from '@/theme/theme';

const CREATE_NEW_SENTINEL = '__create_new__';

/**
 * Best-guess human label for an aggregator-side account type.
 * Monzo's `type` strings (uk_retail, uk_retail_joint, uk_loan, etc)
 * are stable enough to switch on; for unknown values we surface the
 * raw string so the user has *something* to read.
 */
function humanAccountType(type: string | null): string {
  if (!type) return 'Account';
  const map: Record<string, string> = {
    uk_retail: 'Current account',
    uk_retail_joint: 'Joint account',
    uk_business: 'Business account',
    uk_loan: 'Loan',
    uk_rewards: 'Rewards opt-in',
    uk_monzo_flex: 'Monzo Flex',
    uk_savings: 'Savings pot',
  };
  return map[type] ?? type;
}

/** Most users only want to map their everyday spending account. */
function isEverydayAccountType(type: string | null): boolean {
  return type === 'uk_retail' || type === 'uk_retail_joint' || type === 'uk_business';
}

interface AggregatorAccount {
  aggregatorAccountRef: string;
  iban: string | null;
  currency: string;
  ownerName: string | null;
  product: string | null;
  /** Raw aggregator account-type string (Monzo: "uk_retail",
   *  "uk_retail_joint", "uk_loan", "uk_rewards", etc). Used by the
   *  wizard to decide which accounts to suggest binding versus
   *  default-skip. Null when the aggregator doesn't expose it. */
  type: string | null;
}

interface InternalAccount {
  account_id: number;
  account_name: string;
  account_type: string;
  balance: string;
}

interface LinkedAccount {
  id: number;
  accountId: number;
  accountName: string;
  aggregatorAccountRef: string;
  cutoverDate: string | null;
  paysOffAccountId: number | null;
}

interface ConnectionDetail {
  connection: {
    id: number;
    providerDisplayName: string;
    institutionName: string;
    status: string;
  };
  linkedAccounts: LinkedAccount[];
  aggregatorAccounts: AggregatorAccount[];
  aggregatorError: string | null;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body;
};

interface MappingDraft {
  accountId: number | '';
  cutoverDate: string;
  paysOffAccountId: number | null;
}

export default function MappingWizardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const connectionId = parseInt(id, 10);
  const router = useRouter();

  // SWR key conditional on a valid id so we don't fire a request to
  // /api/banking/connections/NaN when the route param is malformed.
  // (We can't conditionally call useSWR; we condition the key
  // instead.)
  const { data, error, isLoading, mutate } = useSWR<ConnectionDetail>(
    Number.isNaN(connectionId) ? null : `/api/banking/connections/${connectionId}`,
    fetcher,
    { revalidateOnFocus: false },
  );
  const { data: accountsData, mutate: mutateAccounts } = useSWR<InternalAccount[]>('/api/accounts?balances=true', fetcher);

  const [drafts, setDrafts] = useState<Record<string, MappingDraft>>({});
  const [submitting, setSubmitting] = useState(false);
  const [snack, setSnack] = useState<{ open: boolean; severity: 'success' | 'error' | 'info'; message: string }>({
    open: false, severity: 'success', message: '',
  });

  const [createDialog, setCreateDialog] = useState<{ aggregatorAccountRef: string; defaultName: string } | null>(null);
  const [createName, setCreateName] = useState('');
  const [creating, setCreating] = useState(false);

  // Pre-populate drafts from any already-linked rows + sane defaults
  // for unlinked aggregator accounts. Non-everyday account types
  // (loans, rewards opt-ins, savings pots) default to Skip so the
  // user only has to think about their actual spending account(s).
  useEffect(() => {
    if (!data) return;
    const today = format(new Date(), 'yyyy-MM-dd');
    const next: Record<string, MappingDraft> = {};
    for (const agg of data.aggregatorAccounts) {
      const linked = data.linkedAccounts.find(l => l.aggregatorAccountRef === agg.aggregatorAccountRef);
      next[agg.aggregatorAccountRef] = {
        accountId: linked?.accountId ?? '',
        cutoverDate: linked?.cutoverDate ?? today,
        paysOffAccountId: linked?.paysOffAccountId ?? null,
      };
    }
    setDrafts(next);
  }, [data]);

  async function handleCreateAccount() {
    if (!createDialog || !createName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: createName.trim(),
          accountType: 'ASSET',
          description: `Bank-fed account synced from ${data?.connection.providerDisplayName ?? 'aggregator'}`,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      // Bind the new account to the row that triggered the dialog.
      setDrafts(d => ({
        ...d,
        [createDialog.aggregatorAccountRef]: {
          ...d[createDialog.aggregatorAccountRef],
          accountId: body.id,
        },
      }));
      // Refresh the accounts list so the new option appears in the
      // dropdown for any other rows the user might want to bind to.
      await mutateAccounts();
      setCreateDialog(null);
      setCreateName('');
      setSnack({ open: true, severity: 'success', message: `Created "${body.name}" and bound it to this row.` });
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Failed to create account' });
    } finally {
      setCreating(false);
    }
  }

  if (Number.isNaN(connectionId)) {
    return (
      <Box>
        <Alert severity="error">Invalid connection id.</Alert>
      </Box>
    );
  }

  async function handleSubmit() {
    if (!data) return;
    setSubmitting(true);
    try {
      const mappings = data.aggregatorAccounts
        .filter(agg => drafts[agg.aggregatorAccountRef]?.accountId !== '')
        .map(agg => {
          const d = drafts[agg.aggregatorAccountRef]!;
          return {
            aggregatorAccountRef: agg.aggregatorAccountRef,
            accountId: d.accountId,
            iban: agg.iban,
            currency: agg.currency,
            product: agg.product,
            cutoverDate: d.cutoverDate,
            paysOffAccountId: d.paysOffAccountId,
          };
        });
      if (mappings.length === 0) {
        setSnack({ open: true, severity: 'error', message: 'Pick at least one account to map.' });
        setSubmitting(false);
        return;
      }
      const res = await fetch(`/api/banking/connections/${connectionId}/map`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mappings }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
      setSnack({ open: true, severity: 'success', message: `Mapped ${body.mappings.length} account${body.mappings.length === 1 ? '' : 's'}` });
      mutate();
      // Auto-jump back after a short delay so the user sees the toast.
      setTimeout(() => router.push('/settings/connections'), 1200);
    } catch (e) {
      setSnack({ open: true, severity: 'error', message: e instanceof Error ? e.message : 'Failed to save mappings' });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Box>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <IconButton size="small" component={Link} href="/settings/connections">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Box>
          <Typography variant="h4">Map accounts</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {data ? `${data.connection.providerDisplayName} - ${data.connection.institutionName}` : 'Loading...'}
          </Typography>
        </Box>
      </Box>

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error.message}</Alert>}
      {data?.aggregatorError && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          Could not fetch accounts from the aggregator: {data.aggregatorError}
        </Alert>
      )}

      {isLoading && <Typography variant="body2" color="text.secondary">Loading aggregator accounts...</Typography>}

      {data && data.aggregatorAccounts.length === 0 && !data.aggregatorError && (
        <Alert severity="info">
          No accounts available from this connection yet. The consent may still be propagating;
          try again in a few seconds.
        </Alert>
      )}

      {data && (
        <Stack spacing={2}>
          {data.aggregatorAccounts.map(agg => {
            const linked = data.linkedAccounts.find(l => l.aggregatorAccountRef === agg.aggregatorAccountRef);
            const draft = drafts[agg.aggregatorAccountRef];
            return (
              <Card key={agg.aggregatorAccountRef}>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5, mb: 2 }}>
                    <Box sx={{
                      width: 36, height: 36, borderRadius: 2.5,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: softTokens.lavender.main, color: softTokens.lavender.ink,
                    }}>
                      <AccountBalanceRoundedIcon sx={{ fontSize: 20 }} />
                    </Box>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {humanAccountType(agg.type)}
                      </Typography>
                      {agg.ownerName && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Owner: {agg.ownerName}
                        </Typography>
                      )}
                      {agg.product && humanAccountType(agg.type) !== agg.product && (
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Product: {agg.product}
                        </Typography>
                      )}
                      <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontFamily: 'monospace', fontSize: '0.7rem', mt: 0.25 }}>
                        {agg.iban ?? agg.aggregatorAccountRef}
                      </Typography>
                    </Box>
                    <Chip label={agg.currency} size="small" />
                    {!isEverydayAccountType(agg.type) && !linked && (
                      <Chip
                        label="Skipped by default"
                        size="small"
                        sx={{ bgcolor: softTokens.stone, color: softTokens.ink2 }}
                      />
                    )}
                    {linked && (
                      <Chip
                        icon={<CheckCircleRoundedIcon sx={{ fontSize: '14px !important' }} />}
                        label="Mapped"
                        size="small"
                        sx={{ bgcolor: softTokens.mint.main, color: softTokens.mint.ink, '& .MuiChip-icon': { color: 'inherit' } }}
                      />
                    )}
                  </Box>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                    <TextField
                      select
                      label="Bind to internal account"
                      size="small"
                      fullWidth
                      value={draft?.accountId ?? ''}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === CREATE_NEW_SENTINEL) {
                          // Open the create-new dialog with a name
                          // pre-filled from the aggregator label so
                          // the user just confirms and saves.
                          const defaultName = `${data.connection.providerDisplayName} ${humanAccountType(agg.type)}`;
                          setCreateName(defaultName);
                          setCreateDialog({ aggregatorAccountRef: agg.aggregatorAccountRef, defaultName });
                          return;
                        }
                        setDrafts(d => ({
                          ...d,
                          [agg.aggregatorAccountRef]: { ...d[agg.aggregatorAccountRef], accountId: v === '' ? '' : Number(v) },
                        }));
                      }}
                      helperText={isEverydayAccountType(agg.type)
                        ? 'Pick an existing ASSET account or create a new one for this Monzo account'
                        : 'Skipped by default - bind only if you want to track this account'}
                    >
                      <MenuItem value=""><em>Skip this account</em></MenuItem>
                      <Divider />
                      {(accountsData ?? [])
                        .filter(a => a.account_type === 'ASSET')
                        .map(a => (
                          <MenuItem key={a.account_id} value={a.account_id}>
                            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 2 }}>
                              <span>{a.account_name}</span>
                              <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.78rem', fontFeatureSettings: '"tnum"' }}>
                                {formatCurrency(a.balance)}
                              </Box>
                            </Box>
                          </MenuItem>
                        ))}
                      <Divider />
                      <MenuItem value={CREATE_NEW_SENTINEL}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: softTokens.lavender.ink }}>
                          <AddRoundedIcon sx={{ fontSize: 18 }} />
                          <em>Create a new account...</em>
                        </Box>
                      </MenuItem>
                    </TextField>
                    <TextField
                      label="Cutover date"
                      type="date"
                      size="small"
                      sx={{ minWidth: 180 }}
                      value={draft?.cutoverDate ?? ''}
                      onChange={(e) => setDrafts(d => ({
                        ...d,
                        [agg.aggregatorAccountRef]: { ...d[agg.aggregatorAccountRef], cutoverDate: e.target.value },
                      }))}
                      slotProps={{ inputLabel: { shrink: true } }}
                      helperText="Sync starts from this date"
                    />
                  </Stack>

                  {/* Pays-off picker. Only meaningful once an internal
                      account is selected; keeps the wizard clean otherwise. */}
                  {draft && draft.accountId !== '' && (
                    <Box sx={{ mt: 1.5 }}>
                      <TextField
                        select
                        label="Account that pays this off (optional)"
                        size="small"
                        fullWidth
                        value={draft.paysOffAccountId ?? ''}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDrafts(d => ({
                            ...d,
                            [agg.aggregatorAccountRef]: {
                              ...d[agg.aggregatorAccountRef],
                              paysOffAccountId: v === '' ? null : Number(v),
                            },
                          }));
                        }}
                        helperText="If this is a credit-card-style account that another account pays off (Bank -> Amex), pick the payer here so the transfer reconciler auto-merges statement payments."
                      >
                        <MenuItem value=""><em>None</em></MenuItem>
                        <Divider />
                        {(accountsData ?? [])
                          .filter(a => a.account_id !== draft.accountId)
                          .map(a => (
                            <MenuItem key={a.account_id} value={a.account_id}>
                              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: 2 }}>
                                <Box component="span">
                                  {a.account_name}
                                  <Box component="span" sx={{ color: 'text.secondary', ml: 1, fontSize: '0.78rem' }}>
                                    ({a.account_type})
                                  </Box>
                                </Box>
                                <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.78rem', fontFeatureSettings: '"tnum"' }}>
                                  {formatCurrency(a.balance)}
                                </Box>
                              </Box>
                            </MenuItem>
                          ))}
                      </TextField>
                    </Box>
                  )}
                </CardContent>
              </Card>
            );
          })}

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5 }}>
            <Button component={Link} href="/settings/connections">Cancel</Button>
            <Button
              variant="contained"
              onClick={handleSubmit}
              disabled={submitting || data.aggregatorAccounts.length === 0}
            >
              {submitting ? 'Saving...' : 'Save mappings'}
            </Button>
          </Box>
        </Stack>
      )}

      <Dialog
        open={createDialog !== null}
        onClose={() => { if (!creating) { setCreateDialog(null); setCreateName(''); } }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>Create a new ASSET account</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            New account on FinAdviser&apos;s side. The bank-fed sync will write its
            transactions here. You can rename or restructure later from the chart
            of accounts.
          </Typography>
          <TextField
            label="Account name"
            fullWidth
            size="small"
            autoFocus
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            helperText="e.g. Monzo, Monzo Joint, Barclays Current"
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setCreateDialog(null); setCreateName(''); }} disabled={creating}>Cancel</Button>
          <Button variant="contained" onClick={handleCreateAccount} disabled={creating || !createName.trim()}>
            {creating ? 'Creating...' : 'Create + bind'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={snack.open}
        autoHideDuration={5000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
      >
        <Alert severity={snack.severity} onClose={() => setSnack(s => ({ ...s, open: false }))}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
