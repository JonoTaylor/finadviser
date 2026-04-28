'use client';

import { useState, useCallback } from 'react';
import {
  Box, Typography, Button, Snackbar, Alert, FormControlLabel, Switch, Stack, Badge,
} from '@mui/material';
import AutoFixHighRoundedIcon from '@mui/icons-material/AutoFixHighRounded';
import SwapHorizRoundedIcon from '@mui/icons-material/SwapHorizRounded';
import Link from 'next/link';
import useSWR from 'swr';
import TransactionFilters from '@/components/transactions/TransactionFilters';
import TransactionTable from '@/components/transactions/TransactionTable';
import CategoryEditDialog from '@/components/transactions/CategoryEditDialog';
import MarkAsTransferDialog from '@/components/transactions/MarkAsTransferDialog';

const fetcher = (url: string) => fetch(url).then(r => r.json());

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

  const { data, isLoading, mutate } = useSWR(`/api/journal?${queryParams}`, fetcher);
  const { data: categories } = useSWR('/api/categories', fetcher);
  const { data: accounts } = useSWR('/api/accounts', fetcher);
  const { data: review } = useSWR<{ candidates: unknown[] }>('/api/journal/transfers/review', fetcher);
  const reviewCount = review?.candidates?.length ?? 0;

  const handleFilterChange = useCallback((newFilters: typeof filters) => {
    setFilters(newFilters);
    setPage(0);
  }, []);

  const handleCategoryUpdate = useCallback(async (journalId: number, categoryId: number, createRule: boolean, description?: string) => {
    await fetch(`/api/journal/${journalId}`, {
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
      const res = await fetch('/api/journal/auto-categorize', { method: 'POST' });
      const result = await res.json();
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
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box>
          <Typography variant="h4">Transactions</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {data?.total ? `${data.total} total` : 'Loading...'}
            {hideTransfers ? ' (transfers hidden)' : ''}
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
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
            disabled={autoCategorizing}
          >
            {autoCategorizing ? 'Categorizing...' : 'Auto-Categorize'}
          </Button>
        </Stack>
      </Box>
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
      <TransactionTable
        entries={data?.entries ?? []}
        total={data?.total ?? 0}
        page={page}
        pageSize={pageSize}
        loading={isLoading}
        onPageChange={setPage}
        onPageSizeChange={setPageSize}
        onRowClick={(entry) => setEditEntry({ id: entry.id, categoryId: entry.category_id, description: entry.description })}
        onMarkAsTransfer={(entry) => setTransferEntry({ id: entry.id, description: entry.description })}
      />
      <CategoryEditDialog
        open={editEntry !== null}
        currentCategoryId={editEntry?.categoryId ?? null}
        description={editEntry?.description}
        categories={categories ?? []}
        onClose={() => setEditEntry(null)}
        onSave={(categoryId, createRule) =>
          editEntry && handleCategoryUpdate(editEntry.id, categoryId, createRule, editEntry.description)
        }
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
