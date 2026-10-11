'use client';

import { useState, useCallback } from 'react';
import {
  Box, Button, Snackbar, Alert, FormControlLabel, Switch, Badge,
} from '@mui/material';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import Link from 'next/link';
import useSWR from 'swr';
import TransactionFilters from '@/components/transactions/TransactionFilters';
import TransactionTable from '@/components/transactions/TransactionTable';
import CategoryEditDialog from '@/components/transactions/CategoryEditDialog';
import MarkAsTransferDialog from '@/components/transactions/MarkAsTransferDialog';
import PageHeader from '@/components/ui/PageHeader';
import { fetchJson } from '@/lib/http/client';
import type { Entry } from '@/components/transactions/TransactionTable';

const fetcher = fetchJson;
async function fetchList<T>(url: string): Promise<T[]> {
  const data = await fetchJson<unknown>(url);
  if (!Array.isArray(data)) throw new Error('This list could not be read. Please retry.');
  return data;
}
async function fetchJournal(url: string): Promise<{ entries: Entry[]; total: number }> {
  const data = await fetchJson<{ entries: Entry[]; total: number }>(url);
  if (!Array.isArray(data.entries) || !Number.isInteger(data.total) || data.total < 0) throw new Error('Your transaction list could not be read. Please retry.');
  return data;
}

export default function TransactionsPage() {
  const [filters, setFilters] = useState({
    q: '',
    categoryId: undefined as number | undefined,
    accountId: undefined as number | undefined,
    startDate: '',
    endDate: '',
  });
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [hideTransfers, setHideTransfers] = useState(true);
  const [editEntry, setEditEntry] = useState<{ id: number; categoryId: number | null; description: string } | null>(null);
  const [transferEntry, setTransferEntry] = useState<{ id: number; description: string } | null>(null);
  const [autoCategorizing, setAutoCategorizing] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'warning' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  });

  const queryParams = new URLSearchParams();
  if (filters.q) queryParams.set('q', filters.q);
  if (filters.categoryId) queryParams.set('categoryId', String(filters.categoryId));
  if (filters.accountId) queryParams.set('accountId', String(filters.accountId));
  if (filters.startDate) queryParams.set('startDate', filters.startDate);
  if (filters.endDate) queryParams.set('endDate', filters.endDate);
  if (hideTransfers) queryParams.set('hideTransfers', 'true');
  queryParams.set('limit', String(pageSize));
  queryParams.set('offset', String(page * pageSize));

  const { data, error, isLoading, mutate } = useSWR(`/api/journal?${queryParams}`, fetchJournal, { shouldRetryOnError: false });
  const { data: categories, error: categoriesError } = useSWR<Parameters<typeof TransactionFilters>[0]['categories']>('/api/categories', fetchList, { shouldRetryOnError: false });
  const { data: accounts, error: accountsError } = useSWR<Parameters<typeof TransactionFilters>[0]['accounts']>('/api/accounts', fetchList, { shouldRetryOnError: false });
  const { data: review } = useSWR<{ candidates: unknown[] }>('/api/journal/transfers/review', fetcher);
  const reviewCount = review?.candidates?.length ?? 0;

  const handleFilterChange = useCallback((newFilters: typeof filters) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const handleCategoryUpdate = useCallback(async (journalId: number, categoryId: number, createRule: boolean, description?: string) => {
    await fetchJson(`/api/journal/${journalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ categoryId, createRule, description }),
    });
    setEditEntry(null);
    mutate();
  }, [mutate]);

  const handleAutoCategorize = useCallback(async () => {
    setAutoCategorizing(true);
    try {
      const result = await fetchJson<{ error?: string; total: number; ruleBased: number; aiCategorized: number; remaining: number; aiSkippedReason?: string }>('/api/journal/auto-categorize', { method: 'POST' });
      if (result.error) {
        setSnackbar({ open: true, message: result.error, severity: 'error' });
      } else if (result.total === 0) {
        setSnackbar({ open: true, message: 'No uncategorized transactions found', severity: 'info' });
      } else {
        const parts: string[] = [];
        if (result.ruleBased > 0) parts.push(`${result.ruleBased} by rules`);
        if (result.aiCategorized > 0) parts.push(`${result.aiCategorized} by AI`);
        if (result.remaining > 0) parts.push(`${result.remaining} remaining`);

        const summary = `Categorized ${result.ruleBased + result.aiCategorized} of ${result.total} transactions: ${parts.join(', ')}`;

        // Surface why AI didn't help — used to be invisible. Common
        // reasons: AI_GATEWAY_API_KEY not set in prod, or the gateway
        // call failed at runtime. The route now returns aiSkippedReason
        // explaining either case.
        if (result.aiSkippedReason) {
          setSnackbar({
            open: true,
            message: `${summary}. ${result.aiSkippedReason}`,
            severity: 'warning',
          });
        } else {
          setSnackbar({ open: true, message: summary, severity: 'success' });
        }
        mutate();
      }
    } catch {
      setSnackbar({ open: true, message: 'Failed to auto-categorize', severity: 'error' });
    } finally {
      setAutoCategorizing(false);
    }
  }, [mutate]);

  return (
    <Box>
      <PageHeader title="Transactions" description={error ? 'Your transaction records are unavailable.' : isLoading ? 'Loading your transaction records…' : `${data?.total ?? 0} transactions${hideTransfers ? ' · transfers hidden' : ''}`} actions={<>
          <Badge badgeContent={reviewCount} color="warning" max={99}>
            <Button
              component={Link}
              href="/transactions/transfers"
              variant="outlined"
              startIcon={<SwapHorizRoundedIcon />}
            >
              Review transfers
            </Button>
          </Badge>
          <Button
            variant="outlined"
            startIcon={<AutoFixHighRoundedIcon />}
            onClick={handleAutoCategorize}
            disabled={autoCategorizing || Boolean(error || categoriesError)}
          >
            {autoCategorizing ? 'Categorising…' : 'Categorise transactions'}
          </Button>
      </>} />
      {(categoriesError || accountsError) && <Alert severity="warning" sx={{ mb: 2 }}>Some filter options could not be loaded. Retry when your accounts and categories are available.</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
        <FormControlLabel
          control={
            <Switch
              size="small"
              checked={hideTransfers}
              onChange={(e) => {
                setHideTransfers(e.target.checked);
                setPage(0);
              }}
            />
          }
          label="Hide transfers"
        />
      </Box>
      <TransactionFilters
        filters={filters}
        categories={categories ?? []}
        accounts={accounts ?? []}
        onFilterChange={handleFilterChange}
      />
      {error ? <Alert severity="warning" action={<Button size="small" onClick={() => void mutate()}>Retry</Button>}>Your transactions could not be loaded. Your records have not been replaced with an empty list.</Alert> : <TransactionTable
        entries={data?.entries ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        loading={isLoading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onRowClick={(entry) => categoriesError ? setSnackbar({ open: true, message: 'Categories could not be loaded. Please reload the page before editing.', severity: 'error' }) : setEditEntry({ id: entry.id, categoryId: entry.category_id, description: entry.description })}
        onMarkAsTransfer={(entry) => setTransferEntry({ id: entry.id, description: entry.description })}
      />}
      <CategoryEditDialog
        open={editEntry !== null}
        currentCategoryId={editEntry?.categoryId ?? null}
        description={editEntry?.description}
        categories={categories ?? []}
        onClose={() => setEditEntry(null)}
        onSave={async (categoryId, createRule) => {
          if (editEntry) await handleCategoryUpdate(editEntry.id, categoryId, createRule, editEntry.description);
        }}
      />
      <MarkAsTransferDialog
        open={transferEntry !== null}
        journalId={transferEntry?.id ?? null}
        description={transferEntry?.description ?? ''}
        onClose={() => setTransferEntry(null)}
        onMarked={() => {
          setSnackbar({ open: true, message: 'Marked as transfer', severity: 'success' });
          mutate();
        }}
      />
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%' }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
}
