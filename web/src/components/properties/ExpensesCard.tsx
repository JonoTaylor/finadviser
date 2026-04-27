'use client';

import { useState } from 'react';
import useSWR from 'swr';
import {
  Card,
  CardContent,
  Typography,
  Stack,
  Button,
  Snackbar,
  Alert,
  CircularProgress,
  Chip,
  Box,
  Divider,
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import ReceiptIcon from '@mui/icons-material/ReceiptLong';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import LinkOffRoundedIcon from '@mui/icons-material/LinkOffRounded';
import Link from 'next/link';
import { format } from 'date-fns';
import { currentTaxYear } from '@/lib/tax/ukTaxYear';
import { formatCurrency } from '@/lib/utils/formatting';
import { getCategoryColor } from '@/lib/utils/category-colors';
import { softTokens } from '@/theme/theme';
import AddExpenseDialog from './AddExpenseDialog';

interface ExpenseRow {
  journalId: number;
  date: string;
  description: string;
  category: string | null;
  account: string;
  amount: string;
}

interface ExpensesResponse {
  expenses: ExpenseRow[];
  count: number;
  limit: number;
}

const fetcher = async (url: string) => {
  const res = await fetch(url);
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `Request failed: ${res.status}`);
  return body as ExpensesResponse;
};

export default function ExpensesCard({ propertyId }: { propertyId: number }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);
  const [snack, setSnack] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false, message: '', severity: 'success',
  });
  const taxYear = currentTaxYear();

  const { data, isLoading, mutate } = useSWR<ExpensesResponse>(
    `/api/properties/${propertyId}/expenses?limit=50`,
    fetcher,
    { revalidateOnFocus: false },
  );

  const handleAutoLink = async () => {
    setLinking(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/auto-link-expenses`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const result = (await res.json()) as { linked: number };
      setSnack({
        open: true,
        severity: result.linked > 0 ? 'success' : 'info',
        message: result.linked > 0
          ? `Linked ${result.linked} previously-unlinked expense${result.linked === 1 ? '' : 's'} to this property.`
          : 'No unlinked property expenses found.',
      });
      if (result.linked > 0) mutate();
    } catch (e) {
      setSnack({ open: true, message: e instanceof Error ? e.message : 'Failed to auto-link', severity: 'error' });
    } finally {
      setLinking(false);
    }
  };

  const handleUntag = async (journalId: number) => {
    setUnlinkingId(journalId);
    try {
      const res = await fetch(`/api/properties/journal/${journalId}/untag`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setSnack({ open: true, severity: 'success', message: 'Removed from this property.' });
      mutate();
    } catch (e) {
      setSnack({ open: true, message: e instanceof Error ? e.message : 'Failed to untag', severity: 'error' });
    } finally {
      setUnlinkingId(null);
    }
  };

  const expenses = data?.expenses ?? [];
  const total = expenses.reduce((sum, e) => sum + parseFloat(e.amount), 0);

  return (
    <Card sx={{ mb: 3 }}>
      <CardContent>
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Typography variant="h6">Expenses</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            <Button
              size="small"
              variant="text"
              startIcon={linking ? <CircularProgress size={14} /> : <LinkRoundedIcon />}
              disabled={linking}
              onClick={handleAutoLink}
              title="Find every transaction categorised under a property-expense category that isn't yet linked to this property, and link them."
            >
              {linking ? 'Linking...' : 'Auto-link existing'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              startIcon={<ReceiptIcon />}
              component={Link}
              href={`/properties/${propertyId}/reports/${taxYear.label}`}
            >
              View on tax-year report
            </Button>
            <Button
              size="small"
              variant="contained"
              startIcon={<AddIcon />}
              onClick={() => setDialogOpen(true)}
            >
              Add expense
            </Button>
          </Stack>
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Record itemised deductible expenses for this property. Use the
          UK BTL categories (repairs, insurance, agent fees, etc.). Mortgage
          interest is tracked separately on its own card under the property&apos;s
          mortgage payments. <strong>Auto-link existing</strong> attaches any
          past transactions you&apos;ve already categorised as property expenses
          to this property in one go - useful after a categorisation pass.
        </Typography>

        <Divider sx={{ mb: 2 }} />

        {isLoading ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <CircularProgress size={20} />
          </Box>
        ) : expenses.length === 0 ? (
          <Box sx={{ py: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              No expenses linked to this property yet. Add one above, or run a
              categorisation pass and click <strong>Auto-link existing</strong>.
            </Typography>
          </Box>
        ) : (
          <>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 1 }}>
              <Typography variant="caption" color="text.secondary">
                Showing {expenses.length} most recent expense{expenses.length === 1 ? '' : 's'}
                {data && data.count >= data.limit ? ` (capped at ${data.limit}; see tax-year report for full history)` : ''}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                Total: {formatCurrency(total.toFixed(2))}
              </Typography>
            </Box>
            <Stack divider={<Divider />}>
              {expenses.map(e => {
                const cat = e.category ? getCategoryColor(e.category) : null;
                return (
                  <Box
                    key={e.journalId}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr auto auto auto',
                      gap: 1.5,
                      alignItems: 'center',
                      py: 1.25,
                    }}
                  >
                    <Typography variant="caption" color="text.secondary" sx={{ whiteSpace: 'nowrap', minWidth: 70 }}>
                      {format(new Date(e.date), 'd MMM yyyy')}
                    </Typography>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
                        {e.description}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        Paid from {e.account}
                      </Typography>
                    </Box>
                    {cat ? (
                      <Chip
                        label={e.category}
                        size="small"
                        sx={{ bgcolor: `${cat.fill}26`, color: cat.ink, fontWeight: 500 }}
                      />
                    ) : (
                      <Chip label="No category" size="small" sx={{ bgcolor: softTokens.stone, color: softTokens.ink2 }} />
                    )}
                    <Typography variant="body2" sx={{ fontWeight: 600, fontFeatureSettings: '"tnum"', whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {formatCurrency(e.amount)}
                    </Typography>
                    <Tooltip title="Untag from this property (the transaction stays in its category, just not on this property's report)">
                      <span>
                        <IconButton
                          size="small"
                          onClick={() => handleUntag(e.journalId)}
                          disabled={unlinkingId === e.journalId}
                          aria-label="Untag from this property"
                        >
                          {unlinkingId === e.journalId
                            ? <CircularProgress size={14} />
                            : <LinkOffRoundedIcon sx={{ fontSize: 18 }} />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                );
              })}
            </Stack>
          </>
        )}
      </CardContent>

      <AddExpenseDialog
        open={dialogOpen}
        propertyId={propertyId}
        onClose={() => setDialogOpen(false)}
        onSaved={() => { setDialogOpen(false); mutate(); }}
      />

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(s => ({ ...s, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnack(s => ({ ...s, open: false }))}
          severity={snack.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snack.message}
        </Alert>
      </Snackbar>
    </Card>
  );
}
